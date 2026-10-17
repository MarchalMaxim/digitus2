import { useT } from '../i18n/i18n.js';
import { type Length, type LengthId, type Tier } from './levels.js';

interface PillOption<T extends string> {
  id: T;
  label: string;
}

interface PillRadiosProps<T extends string> {
  legend: string;
  /** The radio group's name: one group per page, so pills of two groups never share a choice. */
  name: string;
  options: readonly PillOption<T>[];
  value: T;
  onChange(value: T): void;
}

/**
 * Pills (shelves spec 7): native radios in a fieldset, each covering its capsule label (the
 * technique of the Hands control's `.segmented`). Tab enters on the chosen pill; the arrow keys
 * choose. The chosen pill is ink-filled, never red.
 */
function PillRadios<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
}: PillRadiosProps<T>) {
  return (
    <fieldset className="pills">
      <legend className="visually-hidden">{legend}</legend>
      {options.map((o) => (
        <label key={o.id} className="pill">
          <input
            type="radio"
            name={name}
            value={o.id}
            checked={o.id === value}
            onChange={() => onChange(o.id)}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export interface LevelPillsProps {
  tiers: readonly Tier[];
  tier: Tier;
  onChange(tier: Tier): void;
}

/** The level pills (spec 3): Easy, Medium, Harder, Challenging. */
export function LevelPills({ tiers, tier, onChange }: LevelPillsProps) {
  const t = useT();
  return (
    <PillRadios
      legend={t.library.pills.level}
      name="library-level"
      options={tiers.map((id) => ({ id, label: t.library.tiers[id] }))}
      value={tier}
      onChange={onChange}
    />
  );
}

export interface LengthPillsProps {
  /** The lengths the list holds, `Any length` first. */
  lengths: readonly Length[];
  length: LengthId;
  onChange(length: LengthId): void;
}

/** The length pills (shelves spec 4.3), above a list of more than 40 pieces. */
export function LengthPills({ lengths, length, onChange }: LengthPillsProps) {
  const t = useT();
  return (
    <PillRadios
      legend={t.library.pills.length}
      name="library-length"
      options={lengths.map((l) => ({ id: l.id, label: t.library.pills.lengths[l.id] }))}
      value={length}
      onChange={onChange}
    />
  );
}
