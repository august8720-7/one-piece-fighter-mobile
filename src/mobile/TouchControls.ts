import { Btn, SKILL_BUTTONS, type SkillAvailability } from '@core/index';
import { characters } from '@characters/index';
import type { TouchInput } from '@input/touch';

export type TouchInputTarget = Pick<TouchInput, 'setPointer' | 'releasePointer' | 'clear'>;

export interface TouchControlsOptions {
  parent: HTMLElement;
  input: TouchInputTarget;
  onPause: () => void;
  onExit: () => void;
}

export interface TouchButtonDefinition {
  id: string;
  label: string;
  bits: number;
  region: 'direction' | 'attack' | 'skill';
  gridArea?: string;
}

export const TOUCH_DIRECTION_BUTTONS: readonly TouchButtonDefinition[] = [
  { id: 'up-left', label: '↖', bits: Btn.Up | Btn.Left, region: 'direction', gridArea: 'ul' },
  { id: 'up', label: '↑', bits: Btn.Up, region: 'direction', gridArea: 'u' },
  { id: 'up-right', label: '↗', bits: Btn.Up | Btn.Right, region: 'direction', gridArea: 'ur' },
  { id: 'left', label: '←', bits: Btn.Left, region: 'direction', gridArea: 'l' },
  { id: 'right', label: '→', bits: Btn.Right, region: 'direction', gridArea: 'r' },
  { id: 'down-left', label: '↙', bits: Btn.Down | Btn.Left, region: 'direction', gridArea: 'dl' },
  { id: 'down', label: '↓', bits: Btn.Down, region: 'direction', gridArea: 'd' },
  { id: 'down-right', label: '↘', bits: Btn.Down | Btn.Right, region: 'direction', gridArea: 'dr' },
] as const;

export const TOUCH_ATTACK_BUTTONS: readonly TouchButtonDefinition[] = [
  { id: 'light-punch', label: '轻拳', bits: Btn.A, region: 'attack', gridArea: 'lp' },
  { id: 'heavy-punch', label: '重拳', bits: Btn.C, region: 'attack', gridArea: 'hp' },
  { id: 'light-kick', label: '轻脚', bits: Btn.B, region: 'attack', gridArea: 'lk' },
  { id: 'heavy-kick', label: '重脚', bits: Btn.D, region: 'attack', gridArea: 'hk' },
] as const;

export const TOUCH_SKILL_BUTTONS: readonly TouchButtonDefinition[] = SKILL_BUTTONS.map((bits, index) => ({
  id: `skill-${index + 1}`,
  label: `技能${index + 1}`,
  bits,
  region: 'skill' as const,
}));

export function characterSkillLabels(characterId: string): string[] {
  const def = characters[characterId];
  return Array.from({ length: 9 }, (_, index) => {
    const moveId = def?.skillSlots?.[index];
    return def?.moves.find(move => move.id === moveId)?.name ?? `技能${index + 1}`;
  });
}

const REASON_LABEL: Readonly<Record<SkillAvailability['reason'], string>> = {
  ready: '可用', meter: '气不足', air: '空地条件不符', recovery: '硬直中',
  cancel: '不可取消', phase: '等待开战', missing: '未配置',
};

interface ControlBinding {
  element: HTMLButtonElement;
  bits: number;
}

/** DOM-only overlay. It emits P1 bits and never touches FightSim or scenes. */
export class TouchControls {
  readonly element: HTMLElement;
  private readonly skillButtons: HTMLButtonElement[] = [];
  private readonly bindings = new Map<HTMLElement, ControlBinding>();
  private readonly activePointers = new Map<number, ControlBinding>();
  private readonly characterLabel: HTMLElement;

  private readonly onPointerDown = (event: PointerEvent): void => {
    const binding = this.bindingAt(event.target);
    if (!binding || binding.element.disabled) return;
    event.preventDefault();
    try { binding.element.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
    this.applyPointer(event.pointerId, binding);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const binding = this.bindingAt(target);
    this.applyPointer(event.pointerId, binding?.element.disabled ? null : binding);
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (!this.activePointers.has(event.pointerId)) return;
    event.preventDefault();
    this.applyPointer(event.pointerId, null);
  };

  private readonly onContextMenu = (event: Event): void => event.preventDefault();
  private readonly onWindowBlur = (): void => this.clearActive();
  private readonly onVisibility = (): void => { if (document.visibilityState !== 'visible') this.clearActive(); };

  constructor(private readonly options: TouchControlsOptions) {
    this.element = document.createElement('section');
    this.element.className = 'opf-touch-controls';
    this.element.setAttribute('aria-label', '手机格斗操作');

    const top = document.createElement('div');
    top.className = 'opf-touch-topbar';
    this.characterLabel = document.createElement('div');
    this.characterLabel.className = 'opf-touch-character';
    this.characterLabel.textContent = 'P1';
    top.append(this.characterLabel, this.actionButton('暂停', 'opf-touch-menu', options.onPause), this.actionButton('退出', 'opf-touch-menu opf-touch-exit', options.onExit));

    const directions = this.region('方向', 'opf-touch-dpad', TOUCH_DIRECTION_BUTTONS);
    const attacks = this.region('普通攻击', 'opf-touch-attacks', TOUCH_ATTACK_BUTTONS);
    const skills = this.region('一键技能', 'opf-touch-skills', TOUCH_SKILL_BUTTONS);
    this.skillButtons.push(...Array.from(skills.querySelectorAll<HTMLButtonElement>('[data-touch-id^="skill-"]')));
    this.element.append(top, directions, attacks, skills);
    options.parent.append(this.element);

    this.element.addEventListener('pointerdown', this.onPointerDown);
    this.element.addEventListener('pointermove', this.onPointerMove);
    this.element.addEventListener('pointerup', this.onPointerEnd);
    this.element.addEventListener('pointercancel', this.onPointerEnd);
    this.element.addEventListener('lostpointercapture', this.onPointerEnd);
    this.element.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onWindowBlur);
    window.addEventListener('pagehide', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.setCharacter('luffy');
    this.updateAvailability([]);
  }

  setCharacter(id: string): void {
    const def = characters[id];
    this.element.dataset.character = id;
    this.characterLabel.textContent = def ? `P1 · ${def.name}` : 'P1';
    if (def) this.element.style.setProperty('--opf-character-accent', `#${def.color.toString(16).padStart(6, '0')}`);
    const labels = characterSkillLabels(id);
    this.skillButtons.forEach((button, index) => {
      const name = labels[index]!;
      button.replaceChildren(this.keyCap(`S${index + 1}`), this.buttonLabel(name));
      button.setAttribute('aria-label', `技能${index + 1} ${name}`);
    });
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
    this.element.setAttribute('aria-hidden', String(!visible));
    if (!visible) this.clearActive();
  }

  updateAvailability(items: readonly SkillAvailability[]): void {
    this.skillButtons.forEach((button, index) => {
      const item = items[index];
      const available = !!item?.available;
      button.disabled = !available;
      button.classList.toggle('is-unavailable', !available);
      button.dataset.reason = item?.reason ?? 'missing';
      button.title = item ? REASON_LABEL[item.reason] : REASON_LABEL.missing;
      button.setAttribute('aria-description', button.title);
      if (!available) this.releaseBindingsFor(button);
    });
  }

  destroy(): void {
    this.clearActive();
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerEnd);
    this.element.removeEventListener('pointercancel', this.onPointerEnd);
    this.element.removeEventListener('lostpointercapture', this.onPointerEnd);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onWindowBlur);
    window.removeEventListener('pagehide', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.element.remove();
  }

  private region(label: string, className: string, definitions: readonly TouchButtonDefinition[]): HTMLElement {
    const region = document.createElement('div');
    region.className = className;
    region.setAttribute('role', 'group');
    region.setAttribute('aria-label', label);
    for (const definition of definitions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `opf-touch-button opf-touch-${definition.region}`;
      button.dataset.touchId = definition.id;
      button.dataset.bits = String(definition.bits);
      button.setAttribute('aria-label', definition.label);
      if (definition.gridArea) button.style.gridArea = definition.gridArea;
      if (definition.region === 'skill') button.append(this.keyCap(definition.label.replace('技能', 'S')), this.buttonLabel(definition.label));
      else button.textContent = definition.label;
      const binding = { element: button, bits: definition.bits };
      this.bindings.set(button, binding);
      region.append(button);
    }
    return region;
  }

  private actionButton(label: string, className: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', callback);
    return button;
  }

  private keyCap(text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'opf-touch-key';
    span.textContent = text;
    return span;
  }

  private buttonLabel(text: string): HTMLElement {
    const span = document.createElement('span');
    span.className = 'opf-touch-name';
    span.textContent = text;
    return span;
  }

  private bindingAt(target: EventTarget | null): ControlBinding | null {
    if (!(target instanceof Element)) return null;
    const button = target.closest<HTMLElement>('[data-bits]');
    return button && this.element.contains(button) ? this.bindings.get(button) ?? null : null;
  }

  private applyPointer(pointerId: number, binding: ControlBinding | null): void {
    const previous = this.activePointers.get(pointerId);
    if (previous === binding) return;
    if (previous) previous.element.classList.remove('is-pressed');
    if (!binding) {
      this.activePointers.delete(pointerId);
      this.options.input.releasePointer(pointerId);
      return;
    }
    this.activePointers.set(pointerId, binding);
    binding.element.classList.add('is-pressed');
    this.options.input.setPointer(pointerId, binding.bits);
  }

  private releaseBindingsFor(button: HTMLButtonElement): void {
    for (const [pointerId, binding] of this.activePointers) if (binding.element === button) this.applyPointer(pointerId, null);
  }

  private clearActive(): void {
    for (const binding of this.activePointers.values()) binding.element.classList.remove('is-pressed');
    this.activePointers.clear();
    this.options.input.clear();
  }
}
