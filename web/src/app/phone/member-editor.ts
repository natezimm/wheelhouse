import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { AVATARS } from '../core/avatars';
import { FamilyStore, MEMBER_COLORS, Member, MemberDraft, refusalMessage } from '../core/family';
import { AvatarFace } from '../shared/avatar-face';

/** Phone-only: add a family member, or change or remove one. Opened from Settings. */
@Component({
  selector: 'app-member-editor',
  imports: [AvatarFace, ReactiveFormsModule, RouterLink],
  template: `
    <header>
      <a class="back" routerLink="/settings" aria-label="Back to Settings">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </a>
      <h1>{{ id() ? 'Edit member' : 'New member' }}</h1>
    </header>

    @if (missing()) {
      <p class="notice">That family member is no longer here.</p>
    } @else {
      <form class="card" [formGroup]="form" (ngSubmit)="save()">
        <div class="preview" [style.--member]="value().color || null" aria-hidden="true">
          <span class="face big"><app-avatar-face [initial]="initial()" [avatar]="value().avatar" /></span>
        </div>

        <label class="field">
          Name
          <input type="text" formControlName="displayName" maxlength="50" autocomplete="off" />
        </label>

        <fieldset>
          <legend>Picture</legend>
          <div class="pictures" [style.--member]="value().color || null">
            <label class="picture">
              <input type="radio" formControlName="avatar" value="" />
              <span class="face"><app-avatar-face [initial]="initial()" /></span>
              <span class="sr-only">Initial</span>
            </label>
            @for (avatar of avatars; track avatar.id) {
              <label class="picture">
                <input type="radio" formControlName="avatar" [value]="avatar.id" />
                <span class="face"><app-avatar-face [initial]="initial()" [avatar]="avatar.id" /></span>
                <span class="sr-only">{{ avatar.name }}</span>
              </label>
            }
          </div>
        </fieldset>

        <fieldset>
          <legend>Color</legend>
          <div class="swatches">
            @for (color of colors; track color.value) {
              <label class="swatch" [style.--swatch]="color.value">
                <input type="radio" formControlName="color" [value]="color.value" />
                <span class="sr-only">{{ color.name }}</span>
              </label>
            }
          </div>
        </fieldset>

        <fieldset>
          <legend>Role</legend>
          <div class="roles">
            <label><input type="radio" formControlName="role" value="Parent" /> Parent</label>
            <label><input type="radio" formControlName="role" value="Kid" /> Kid</label>
          </div>
          <p class="hint">Parents manage the family. Kids are profiles only and have no sign-in.</p>
        </fieldset>

        <button class="button primary" type="submit" [disabled]="form.invalid || busy()">
          {{ id() ? 'Save' : 'Add to family' }}
        </button>

        @if (id()) {
          @if (confirmingRemoval()) {
            <div class="confirm">
              <span>Remove {{ existing()?.displayName }} from the family?</span>
              <button class="button danger" type="button" [disabled]="busy()" (click)="remove()">Remove</button>
              <button class="button" type="button" (click)="confirmingRemoval.set(false)">Keep</button>
            </div>
          } @else {
            <button class="button quiet-danger" type="button" (click)="confirmingRemoval.set(true)">
              Remove from family
            </button>
          }
        }

        <p class="message" role="alert">{{ message() }}</p>
      </form>
    }
  `,
  styles: `
    :host {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 20px 18px 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 720px;
      margin: 0 auto;
    }

    header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    h1 {
      margin: 0;
      font-family: var(--font-display);
      font-size: 30px;
      font-weight: var(--display-weight);
      font-variation-settings: var(--display-variation);
      letter-spacing: -0.02em;
    }

    .back {
      width: 44px;
      height: 44px;
      border-radius: 22px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    fieldset {
      margin: 0;
      padding: 0;
      border: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    legend {
      padding: 0;
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
    }

    .swatches {
      display: grid;
      grid-template-columns: repeat(4, 48px);
      gap: 12px;
      /* Room above and below for the chosen swatch's ring, drawn 6 px outside the circle. */
      padding-block: 6px;
    }

    /* The whole circle is the radio's label; a ring marks the chosen one. */
    .swatch {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--swatch);
      cursor: pointer;
    }

    .swatch input {
      position: absolute;
      opacity: 0;
    }

    .swatch:has(input:checked) {
      box-shadow:
        0 0 0 3px var(--surface),
        0 0 0 6px var(--ink);
    }

    .swatch:has(input:focus-visible) {
      outline: 3px solid var(--accent);
      outline-offset: 7px;
    }

    .preview {
      display: flex;
      justify-content: center;
    }

    /* A picture or initial on the chosen color, drawn the way every screen draws an avatar. */
    .face {
      width: 100%;
      aspect-ratio: 1;
      box-sizing: border-box;
      border: var(--avatar-border);
      border-radius: 50%;
      background: var(--member-strong, var(--muted));
      color: var(--on-avatar);
      font-size: 22px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .face.big {
      width: 88px;
      font-size: 40px;
    }

    .pictures {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
      gap: 12px;
      padding: 6px;
    }

    .picture {
      position: relative;
      display: block;
      min-height: 44px;
      border-radius: 50%;
      cursor: pointer;
    }

    .picture input {
      position: absolute;
      opacity: 0;
    }

    .picture:has(input:checked) {
      box-shadow:
        0 0 0 3px var(--surface),
        0 0 0 6px var(--ink);
    }

    .picture:has(input:focus-visible) {
      outline: 3px solid var(--accent);
      outline-offset: 7px;
    }

    .roles {
      display: flex;
      gap: 24px;
    }

    .roles label {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 44px;
      font-size: 16px;
    }

    .roles input {
      width: 22px;
      height: 22px;
      margin: 0;
      accent-color: var(--ink);
    }

    .hint {
      margin: 0;
      font-size: 13px;
      color: var(--muted);
    }

    .confirm {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      font-size: 15px;
    }

    .confirm span {
      grid-column: 1 / -1;
    }

    .message {
      margin: 0;
      min-height: 20px;
      font-size: 14px;
      color: var(--warn);
    }

    .notice {
      margin: auto 0;
      text-align: center;
      font-family: var(--font-display);
      font-size: 22px;
      color: var(--muted);
    }
  `,
})
export class MemberEditor {
  /** The member to edit, from the route. Absent when adding a new one. */
  readonly id = input<string>();

  private readonly family = inject(FamilyStore);
  private readonly router = inject(Router);

  protected readonly colors = MEMBER_COLORS;
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly confirmingRemoval = signal(false);

  protected readonly existing = computed(() => this.family.members().find((member) => member.id === this.id()));
  protected readonly missing = computed(
    () => !!this.id() && this.family.state().status === 'ready' && !this.existing(),
  );

  protected readonly form = inject(FormBuilder).nonNullable.group({
    displayName: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(50)]],
    color: ['', Validators.required],
    role: ['Kid' as Member['role'], Validators.required],
    /** A picture's id, or empty for the initial. */
    avatar: [''],
  });

  protected readonly avatars = AVATARS;
  protected readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  /** The initial the server will give the name, for the previews. */
  protected readonly initial = computed(() => [...(this.value().displayName ?? '').trim()][0]?.toUpperCase() || '?');

  constructor() {
    if (this.family.state().status === 'loading') {
      this.family.load();
    }

    // Fill the form from the member once it is known, but never over edits in progress.
    effect(() => {
      const member = this.existing();
      if (member && !this.form.dirty) {
        this.form.reset({ displayName: member.displayName, color: member.color, role: member.role, avatar: member.avatar ?? '' });
      }
    });
  }

  protected save(): void {
    if (this.form.invalid) {
      return;
    }

    const value = this.form.getRawValue();
    const draft: MemberDraft = { ...value, displayName: value.displayName.trim(), avatar: value.avatar || null };
    const id = this.id();
    this.finish(id ? this.family.updateMember(id, draft) : this.family.addMember(draft));
  }

  protected remove(): void {
    const id = this.id();
    if (id) {
      this.finish(this.family.removeMember(id));
    }
  }

  /** Runs a change and returns to Settings when the server accepts it. */
  private finish(change: Observable<unknown>): void {
    this.busy.set(true);
    this.message.set('');
    change.subscribe({
      next: () => void this.router.navigateByUrl('/settings'),
      error: (error: unknown) => {
        this.busy.set(false);
        this.confirmingRemoval.set(false);
        this.message.set(refusalMessage(error, 'Could not save. Try again in a moment.'));
      },
    });
  }
}
