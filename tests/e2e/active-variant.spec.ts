import { test, expect } from '@playwright/test';

// Confirms the variants table bolds the row that matches the preview
// player's current level. Runs against two streams: one where the component
// uses the video I-frame player (PBS test pattern) and one where it uses
// the image (MJPG) path (Apple adv_dv_atmos).
async function activeRowInfo(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll('#variantsBody tr[data-url]'),
    ) as HTMLTableRowElement[];
    const active = rows.find((r) => r.classList.contains('active'));
    const preview = document.getElementById('preview') as any;
    const player = preview.player;
    const level = player?.levels?.[player.currentLevel];
    const levelUrls = level?.url || (level?.uri ? [level.uri] : []);
    return {
      total: rows.length,
      activeCount: rows.filter((r) => r.classList.contains('active')).length,
      activeUrl: active?.dataset.url ?? null,
      activeIndex: active?.dataset.index ?? null,
      activeFontWeight: active
        ? window.getComputedStyle(active.querySelector('td')!).fontWeight
        : null,
      playerLevelUrls: levelUrls,
      playerLevelWidth: level?.width ?? null,
      playerLevelHeight: level?.height ?? null,
      hasAttachImage: typeof player?.attachImage === 'function',
      statusText: document.getElementById('iframePlayerStatus')?.textContent ?? '',
    };
  });
}

test('PBS test pattern (video iframe player) bolds the active row', async ({
  page,
}) => {
  await page.goto('/advanced.html');
  await page.locator('#presetSelect').selectOption('pbs-test-pattern');

  // Wait for the preview player to exist, then poke `mediapreviewtime`
  // repeatedly — autoStartLoad is false so the highlight doesn't fire until
  // the first loadMediaAt → LEVEL_SWITCHED. Re-poke at increasing times
  // because dedupe inside the component skips repeats within 0.1s.
  await page.waitForFunction(
    () => !!(document.getElementById('preview') as any).player,
    null,
    { timeout: 20_000 },
  );
  for (const t of [2, 5, 10, 20]) {
    await page.evaluate((v) => {
      document.getElementById('preview')!.setAttribute('mediapreviewtime', v);
    }, String(t));
    await page.waitForTimeout(500);
  }
  // The highlight is the proof: wait for any row to gain the .active class.
  await expect(
    page.locator('#variantsBody tr.active'),
  ).toHaveCount(1, { timeout: 20_000 });

  const info = await activeRowInfo(page);
  console.log('PBS active-variant:', info);
  expect(info.total).toBeGreaterThan(0);
  expect(info.activeCount).toBe(1);
  expect(info.activeUrl).not.toBeNull();
  expect(info.playerLevelUrls).toContain(info.activeUrl);
  expect(+info.activeFontWeight!).toBeGreaterThanOrEqual(600);
  expect(info.hasAttachImage).toBe(false);
  // Status text references the variant index from the table, not the
  // iframe instance's internal level index (which can differ).
  expect(info.statusText).toMatch(new RegExp(`\\bvariant ${info.activeIndex}\\b`));
});

test('apple-bipbop-hevc: bolded row matches the player level even when the variants table includes codec-paired entries', async ({
  page,
}) => {
  await page.goto('/advanced.html');
  await page.locator('#presetSelect').selectOption('apple-bipbop-hevc');

  await page.waitForFunction(
    () => !!(document.getElementById('preview') as any).player,
    null,
    { timeout: 30_000 },
  );
  for (const t of [2, 5, 10, 20]) {
    await page.evaluate((v) => {
      document.getElementById('preview')!.setAttribute('mediapreviewtime', v);
    }, String(t));
    await page.waitForTimeout(500);
  }
  await expect(
    page.locator('#variantsBody tr.active'),
  ).toHaveCount(1, { timeout: 20_000 });

  const info = await activeRowInfo(page);
  console.log('apple-bipbop-hevc active-variant:', info);
  // Regression guard for the bug the user reported: variants table is
  // populated from main hls.iframeVariants (un-merged, all codecs) but
  // player.levels reflects the iframe instance's processed/merged list,
  // so the only reliable join key is the variant's URL.
  expect(info.activeCount).toBe(1);
  expect(info.activeUrl).not.toBeNull();
  expect(info.playerLevelUrls).toContain(info.activeUrl);
  expect(+info.activeFontWeight!).toBeGreaterThanOrEqual(600);
  expect(info.statusText).toMatch(new RegExp(`\\bvariant ${info.activeIndex}\\b`));
});

test('adv_dv_atmos (image MJPG iframe player) bolds the MJPG variant row', async ({
  page,
}) => {
  await page.goto('/advanced.html');
  await page.locator('#presetSelect').selectOption('apple-adv-dv-atmos');

  await page.waitForFunction(
    () => !!(document.getElementById('preview') as any).player,
    null,
    { timeout: 30_000 },
  );
  for (const t of [2, 5, 10, 20]) {
    await page.evaluate((v) => {
      document.getElementById('preview')!.setAttribute('mediapreviewtime', v);
    }, String(t));
    await page.waitForTimeout(500);
  }
  await expect(
    page.locator('#variantsBody tr.active'),
  ).toHaveCount(1, { timeout: 20_000 });

  const info = await activeRowInfo(page);
  console.log('adv_dv_atmos active-variant:', info);
  expect(info.total).toBeGreaterThan(0);
  expect(info.activeCount).toBe(1);
  expect(info.activeUrl).not.toBeNull();
  expect(info.playerLevelUrls).toContain(info.activeUrl);
  expect(+info.activeFontWeight!).toBeGreaterThanOrEqual(600);
  expect(info.hasAttachImage).toBe(true);
  expect(info.statusText).toMatch(new RegExp(`\\bvariant ${info.activeIndex}\\b`));
});
