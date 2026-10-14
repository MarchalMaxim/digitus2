import { LEVEL_NAMES, type Level } from './levels.js';

export interface LevelPillsProps {
  levels: readonly Level[];
  level: Level;
  /** The id of the level line, which describes every pill. */
  describedBy: string;
  onChange(level: Level): void;
}

/**
 * The level pills (spec 4.1, 11): native radios in a fieldset, each covering its capsule label
 * (the technique of the Hands control's `.segmented`). Tab enters on the chosen pill; the arrow
 * keys choose. The chosen pill is ink-filled, never red.
 */
export function LevelPills({ levels, level, describedBy, onChange }: LevelPillsProps) {
  return (
    <fieldset className="pills level-pills">
      <legend className="visually-hidden">Level</legend>
      {levels.map((l) => (
        <label key={l} className="pill">
          <input
            type="radio"
            name="library-level"
            value={l}
            checked={l === level}
            aria-describedby={describedBy}
            onChange={() => onChange(l)}
          />
          <span>{LEVEL_NAMES[l]}</span>
        </label>
      ))}
    </fieldset>
  );
}
