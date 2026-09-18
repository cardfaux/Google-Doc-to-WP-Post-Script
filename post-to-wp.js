#!/usr/bin/env node
/**
 * NOT meant to run in this sandbox - it needs real network access to
 * blackdigitalgroup.com, which this environment doesn't have. Run this
 * via Claude Code locally (same setup used for the Capital Insights
 * publishing flow), from the same machine/account that already has the
 * WordPress Application Password.
 *
 * WHAT IT DOES:
 *   1. For the 3 shared images (1 featured + 2 gallery), first checks the
 *      media library for an existing file with that exact filename and
 *      reuses its attachment ID if found - only uploads if no match
 *      exists. Either way, the resulting IDs are cached in
 *      media-ids.json so this check/upload only ever happens once.
 *   2. Reads wp-payload.json (from build-payload.js) and creates each
 *      case study as a DRAFT `work` post with its ACF fields set,
 *      reusing those 3 cached attachment IDs.
 *   3. Writes results.json: { case_number, wp_post_id, status, error? }
 *      for every attempted post, so failures are easy to find and retry
 *      without re-running everything.
 *
 * USAGE:
 *   WP_URL=https://blackdigitalgroup.com \
 *   WP_USER=you@example.com \
 *   WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx" \
 *   node post-to-wp.js wp-payload.json
 *
 * SAFETY:
 *   - Every post is created with status: "draft" (see build-payload.js) -
 *     nothing here publishes anything live.
 *   - Run with --limit 3 first (see below) to sanity-check a handful of
 *     posts and their ACF fields in wp-admin before doing all 138.
 *   - Flagged cases (unverified stats/attribution - see each record's
 *     `flagged`/`flag_note`) are still created as drafts by default, just
 *     clearly marked, so they surface in wp-admin for review rather than
 *     being silently skipped. Pass --skip-flagged to leave them out of
 *     this run entirely instead.
 */

const fs = require('fs');
const path = require('path');

let WP_URL = process.env.WP_URL;
let WP_USER = process.env.WP_USER;
let WP_APP_PASSWORD = process.env.WP_APP_PASSWORD;
let configLimit = null;

const configPath = path.join(__dirname, 'wp-config.json');
if (fs.existsSync(configPath)) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  WP_URL = WP_URL || config.WP_URL;
  WP_USER = WP_USER || config.WP_USER;
  WP_APP_PASSWORD = WP_APP_PASSWORD || config.WP_APP_PASSWORD;

  // Checks for uppercase "LIMIT" or lowercase "limit" in the config file
  if (config.LIMIT !== undefined) configLimit = config.LIMIT;
  if (config.limit !== undefined) configLimit = config.limit;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!WP_URL || !WP_USER || !WP_APP_PASSWORD) {
  console.error('Missing credentials: Set them in wp-config.json or as environment variables.');
  process.exit(1);
}

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith('--'));

// Check terminal for a limit, otherwise fall back to the config file limit
const limitFlagIdx = args.indexOf('--limit');
const limit = limitFlagIdx !== -1 ? parseInt(args[limitFlagIdx + 1], 10) : configLimit;

const skipFlagged = args.includes('--skip-flagged');

if (!inputPath) {
  console.error('Usage: node post-to-wp.js <wp-payload.json> [--limit N] [--skip-flagged]');
  process.exit(1);
}

const authHeader = 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64');
const MEDIA_IDS_CACHE = path.join(__dirname, 'media-ids.json');

async function wpFetch(endpoint, options = {}) {
  const res = await fetch(`${WP_URL}/wp-json${endpoint}`, {
    ...options,
    headers: {
      Authorization: authHeader,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = typeof body === 'object' && body && body.message ? body.message : text;
    throw new Error(`HTTP ${res.status} on ${endpoint}: ${msg}`);
  }
  return body;
}

async function findExistingMedia(imageUrl) {
  const filename = imageUrl.split('/').pop();
  const nameNoExt = filename.replace(/\.[^.]+$/, '');
  const results = await wpFetch(`/wp/v2/media?search=${encodeURIComponent(nameNoExt)}&per_page=20`);
  // Match on the actual source filename, not just a fuzzy search hit -
  // the search endpoint can return near-matches, so confirm the real
  // uploaded file name matches before trusting it's the same image.
  const match = results.find((m) => {
    const existingFilename = (m.source_url || '').split('/').pop();
    return existingFilename === filename;
  });
  return match ? match.id : null;
}

async function uploadImageFromUrl(imageUrl) {
  const existingId = await findExistingMedia(imageUrl);
  if (existingId) {
    console.error(
      `  found existing media for ${imageUrl.split('/').pop()} -> attachment #${existingId} (skipped upload)`,
    );
    return existingId;
  }

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Could not fetch source image ${imageUrl}: HTTP ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const filename = imageUrl.split('/').pop();
  const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

  const media = await wpFetch('/wp/v2/media', {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body: buffer,
  });
  return media.id;
}

async function getOrCreateMediaIds(payload) {
  if (fs.existsSync(MEDIA_IDS_CACHE)) {
    console.error('Reusing cached media IDs from media-ids.json (delete this file to force re-upload).');
    return JSON.parse(fs.readFileSync(MEDIA_IDS_CACHE, 'utf8'));
  }

  const sample = payload[0];
  console.error('Uploading the 3 shared images once...');
  const featuredId = await uploadImageFromUrl(sample.featured_image_url);
  console.error(`  featured image -> attachment #${featuredId}`);
  const galleryIds = [];
  for (const url of sample.acf.hero_gallery_urls) {
    const id = await uploadImageFromUrl(url);
    galleryIds.push(id);
    console.error(`  gallery image -> attachment #${id}`);
  }

  const ids = { featuredId, galleryIds };
  fs.writeFileSync(MEDIA_IDS_CACHE, JSON.stringify(ids, null, 2));
  return ids;
}

async function createPost(record, mediaIds) {
  const yoast = record.yoast_meta || {};

  // Format the secondary keyphrases for Yoast Premium
  const formattedSecondaryKeywords = (yoast.secondary_keyphrases || []).map((kw) => ({
    keyword: kw,
  }));

  const body = {
    title: record.title,
    slug: record.slug,
    status: record.status,
    featured_media: mediaIds.featuredId,

    // Assigns the post to your new category ID (183)
    'work-category': [183],

    acf: {
      ...record.acf,
      hero_gallery: mediaIds.galleryIds,
      testimonial_image: null,
    },
    meta: {
      _yoast_wpseo_title: yoast.seo_title || '',
      _yoast_wpseo_metadesc: yoast.meta_description || '',
      _yoast_wpseo_focuskw: yoast.focus_keyword || '',
      _yoast_wpseo_focuskeywords: JSON.stringify(formattedSecondaryKeywords),
    },
  };

  return wpFetch(`/wp/v2/${record.post_type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main() {
  let payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (skipFlagged) payload = payload.filter((r) => !r.flagged);
  if (limit) payload = payload.slice(0, limit);

  console.error(`About to create ${payload.length} draft post(s) on ${WP_URL}.`);

  const mediaIds = await getOrCreateMediaIds(payload);

  const results = [];
  for (const record of payload) {
    try {
      const post = await createPost(record, mediaIds);
      console.error(`#${record.case_number} -> created post ${post.id} (${record.title})`);
      results.push({ case_number: record.case_number, wp_post_id: post.id, status: 'ok' });
    } catch (err) {
      console.error(`#${record.case_number} -> FAILED: ${err.message}`);
      results.push({ case_number: record.case_number, status: 'error', error: err.message });
    }

    // RATE LIMITER: Pause for 1.5 seconds before processing the next record
    await sleep(1500);
  }

  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => r.status === 'error');
  console.error(`\nDone. ${results.length - failed.length} succeeded, ${failed.length} failed.`);
  if (failed.length) console.error('See results.json for details on which case_numbers failed and why.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
