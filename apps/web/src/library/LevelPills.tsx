import { TIER_NAMES, type Length, type LengthId, type Tier } from './levels.js';

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
  /** The id of a line that describes every pill, when there is one. */
  describedBy?: string;
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
  describedBy,
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
            aria-describedby={describedBy}
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
  /** The id of the level line, which describes every pill. */
  describedBy: string;
  onChange(tier: Tier): void;
}

/** The level pills (spec 3): Easy, Medium, Challenging. */
export function LevelPills({ tiers, tier, describedBy, onChange }: LevelPillsProps) {
  return (
    <PillRadios
      legend="Level"
      name="library-level"
      options={tiers.map((t) => ({ id: t, label: TIER_NAMES[t] }))}
      value={tier}
      describedBy={describedBy}
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
  return (
    <PillRadios
      legend="Length"
      name="library-length"
      options={lengths}
      value={length}
      onChange={onChange}
    />
  );
}
