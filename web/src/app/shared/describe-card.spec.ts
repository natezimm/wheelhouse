import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TimeoutError } from 'rxjs';
import { aiRefusal, DescribedEvent } from '../core/ai';
import { DescribeCard, describeHints } from './describe-card';

describe('Describe it', () => {
  const described: DescribedEvent = {
    calendarId: 'nora', title: 'Soccer', location: null, allDay: false,
    startDate: '2026-11-10', startTime: '17:15:00', endDate: '2026-11-10', endTime: '18:15:00',
    recurrence: null, memberIds: [], unclear: ['repeat', 'time'],
  };

  function setup(examples: string[] | null = null) {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(DescribeCard);
    fixture.componentRef.setInput('examples', examples);
    const emitted: DescribedEvent[] = [];
    fixture.componentInstance.described.subscribe((d) => emitted.push(d));
    fixture.detectChanges();
    return { fixture, http: TestBed.inject(HttpTestingController), emitted, el: fixture.nativeElement as HTMLElement };
  }

  function type(el: HTMLElement, text: string) {
    const input = el.querySelector('input')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }

  it('sends the words and fills the form, saying what to check', async () => {
    const { fixture, http, emitted, el } = setup();
    type(el, 'Nora soccer Tuesday');
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.row button')!.click();
    fixture.detectChanges();

    const request = http.expectOne('/api/ai/describe');
    expect(request.request.body).toEqual({ text: 'Nora soccer Tuesday' });
    expect(el.querySelector('.row button')!.textContent).toContain('Reading');
    request.flush(described);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(emitted).toEqual([described]);
    const status = el.querySelector('#describe-status')!.textContent!;
    expect(status).toContain('Filled in from your words. Check it, then Save.');
    // In the form's order: the time before the repeat.
    expect([...el.querySelectorAll('.hint')].map((p) => p.textContent)).toEqual(describeHints(['time', 'repeat']));
  });

  it('fills in on Enter, without submitting the form around it', () => {
    const { fixture, http, el } = setup();
    type(el, 'lunch');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    el.querySelector('input')!.dispatchEvent(enter);
    fixture.detectChanges();

    expect(enter.defaultPrevented).toBe(true);
    http.expectOne('/api/ai/describe');
  });

  it('offers the demo’s examples until the form is filled', () => {
    const { fixture, http, el } = setup(['Milo dentist next Thursday at 3']);
    const example = el.querySelector<HTMLButtonElement>('.example')!;
    expect(example.textContent).toContain('Milo dentist');
    example.click();
    fixture.detectChanges();

    expect(http.expectOne('/api/ai/describe').request.body).toEqual({ text: 'Milo dentist next Thursday at 3' });
    expect(el.querySelector('.example')).toBeNull();
  });

  it('says the form still works when the assistant cannot help', () => {
    const { fixture, http, emitted, el } = setup();
    type(el, 'lunch');
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.row button')!.click();
    http.expectOne('/api/ai/describe').flush({ reason: 'Budget' }, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();

    expect(emitted).toEqual([]);
    expect(el.querySelector('.problem')!.textContent).toContain('done its share for today');
  });

  it('says why for each kind of refusal', () => {
    const response = (status: number, error: unknown = null) => new HttpErrorResponse({ status, error });
    expect(aiRefusal(response(429))).toContain('Too many tries');
    expect(aiRefusal(response(503, { reason: 'Failed' }))).toContain("Couldn't fill it in");
    expect(aiRefusal(response(400))).toContain('300 letters');
    expect(aiRefusal(new TimeoutError())).toContain('took too long');
  });
});
