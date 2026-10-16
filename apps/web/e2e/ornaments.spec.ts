import { expect, test } from '@playwright/test';
import { closePractice, openPractice, setLoopBars } from './helpers/practice.js';

const xml = `<score-partwise version="4.0"><work><work-title>Ornament playback check</work-title></work><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>B</step><octave>4</octave></pitch><duration>16</duration><type>whole</type><notations><ornaments><trill-mark start-note="upper" beats="4"/></ornaments><technical><fingering>2</fingering></technical></notations></note></measure></part></score-partwise>`;

test('imported trill uses its unwritten upper key without a false finger digit and preserves the score cursor', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?audio=silent');
  await page.getByLabel('Open your own score', { exact: true }).setInputFiles({
    name: 'ornaments.musicxml',
    mimeType: 'application/xml',
    buffer: Buffer.from(xml),
  });
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toBeEnabled({ timeout: 20_000 });
  await expect(page.locator('.score-sheet g.fing')).toHaveCount(1);
  await openPractice(page);
  await page.getByRole('checkbox', { name: 'Count-in' }).uncheck();
  await page.getByRole('slider', { name: 'Tempo', exact: true }).fill('50');
  await setLoopBars(page, '1', '1');
  await closePractice(page);
  await play.click();
  const upper = page.locator('.keyboard .key[data-midi="72"]');
  const principal = page.locator('.keyboard .key[data-midi="71"]');
  await expect(upper).toHaveClass(/is-pressed/);
  await expect(upper.locator('text')).toHaveCount(0);
  const ids = await page
    .locator('.score-sheet .is-red')
    .evaluateAll((els) => els.map((el) => el.id));
  expect(ids.length).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('ornament-upper-key.png') });
  await expect(principal).toHaveClass(/is-pressed/);
  await expect(principal.locator('text')).not.toHaveCount(0);
  expect(
    await page.locator('.score-sheet .is-red').evaluateAll((els) => els.map((el) => el.id)),
  ).toEqual(ids);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(play).toBeEnabled();
});
