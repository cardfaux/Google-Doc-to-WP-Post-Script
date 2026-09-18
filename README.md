# WordPress REST API Bulk Importer (work Custom Post Type)

A lightweight Node.js automation utility for batch-importing case studies, custom fields, taxonomies, and Yoast Premium SEO metadata into a WordPress site via the REST API.

Designed specifically for host-conscious deployments (e.g., WP Engine) with built-in rate-limiting, media deduplication caching, and result tracking.

## Features

- Yoast SEO Premium Integration: Maps primary focus keyphrases, custom titles, meta descriptions, and formats secondary keyphrases into Yoast's stringified JSON object array format (`_yoast_wpseo_focuskeywords`).
- Taxonomy Assignment: Automatically maps created posts to target category IDs (e.g., `'work-category': [183]`).
- ACF Support: Seamlessly populates top-level Advanced Custom Fields payload structures.
- Smart Media Management: Checks the WordPress media library for existing assets by filename before uploading, caching IDs locally in `media-ids.json` to avoid duplicate assets.
- Server-Friendly Rate Limiting: Built-in sleep delays (1.5s per request) to prevent triggering host firewalls, `429 Too Many Requests` blocks, or database locks.
- Fail-Safe Execution: Outputs execution metrics and detailed per-post success/failure tracking to `results.json`.

## Configuration

Create a `wp-config.json` file in the root of the directory to store your WordPress credentials and optional run limits:

```json
{
  "WP_URL": "https://blackdigitalgroup.com",
  "WP_USER": "your_email@blackdigitalgroup.com",
  "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx",
  "LIMIT": null
}
```

> Note: Add `wp-config.json` to your `.gitignore` to prevent committing Application Passwords to version control.

### Option 2: Environment Variables

Alternatively, pass credentials on execution via terminal flags:

```bash
  WP_URL=https://blackdigitalgroup.com \
  WP_USER=your_email@blackdigitalgroup.com \
  WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx" \
  node post-to-wp.js wp-payload.json
```

## Requirements & Setup

1. WordPress Plugin Helper: Ensure the custom REST API helper plugin is enabled on the WordPress site to expose custom post type meta fields (`_yoast_wpseo_focuskeywords`, etc.) to `/wp-json/wp/v2/work`.
2. Node.js: Ensure Node.js v18+ is installed locally.

## Usage

### 1. Test Run (Limited Import)

Set a limit in `wp-config.json` (`"LIMIT": 3`) or run with the `--limit` flag to verify field mapping in the WordPress admin dashboard:

```bash
  node post-to-wp.js wp-payload.json --limit 1
```

### 2. Full Bulk Import

Ensure "`LIMIT": null` is set in `wp-config.json`, then execute the full run:

```bash
  node post-to-wp.js wp-payload.json
```

### 3. Skip Flagged Entries

To exclude unverified or flagged payload records during execution:

```bash
  node post-to-wp.js wp-payload.json --skip-flagged
```

## Output Files

- `media-ids.json`: Cache of uploaded media attachment IDs to eliminate redundant image processing.
- `results.json`: Summary output mapping `case_number` to generated `wp_post_id` and error logs.
