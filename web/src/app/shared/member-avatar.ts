import { Component, input } from '@angular/core';
import { Member } from '../core/family';
import { AvatarFace } from './avatar-face';

/** A member's picture, or their initial, on a circle of their color. Size it with the --avatar-size property. */
@Component({
  selector: 'app-member-avatar',
  imports: [AvatarFace],
  template: '<app-avatar-face [initial]="member().initial" [avatar]="member().avatar" />',
  host: {
    '[style.--member]': 'member().color',
    'aria-hidden': 'true',
  },
  styles: `
    :host {
      --size: var(--avatar-size, 34px);
      flex-shrink: 0;
      width: var(--size);
      height: var(--size);
      box-sizing: border-box;
      border: var(--avatar-border);
      border-radius: 50%;
      background: var(--member-strong);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--on-avatar);
      font-size: calc(var(--size) * 0.45);
      font-weight: 700;
    }
  `,
})
export class MemberAvatar {
  readonly member = input.required<Member>();
}
