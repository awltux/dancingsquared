#!/usr/bin/env node
/*
   Dancing Squared - publish the built book to S3 (and optionally invalidate CloudFront)

   Copyright (C) 2026 Awltux Limited. AGPL-3.0-or-later.

   Wraps the AWS CLI rather than reimplementing SigV4, so `aws` must be on PATH and
   authenticated (`aws configure`, SSO, or the usual AWS_* environment variables).

   What it does, in order:
     1. checks the built site exists (run `npm run build:book` first)
     2. checks the AWS CLI is installed and the caller is authenticated
     3. bulk-syncs every asset with a one-hour cache header
     4. re-syncs the volatile files (*.html, sw.js) with `no-cache`, so a new build
        is actually seen - a long-cached sw.js or page would pin readers to the old one
     5. re-uploads manifest.webmanifest with the correct Content-Type, because the
        CLI's extension map does not always know `.webmanifest` and a manifest served
        as application/octet-stream can stop the PWA installing
     6. invalidates the CloudFront distribution, if one is configured

   The two sync passes matter: `aws s3 sync` applies a single --cache-control to the
   whole invocation, and mixing `no-cache` and a long max-age in one pass is not
   possible. Excludes are ordered so the second pass cannot delete the first pass's
   objects (`--delete` honours --include/--exclude).

   Usage:
     npm run deploy:book -- --bucket my-bucket [--prefix dancingsquared_book]
                                          [--distribution E123ABC] [--dryrun]

   Configuration is taken from flags first, then the environment:
     --bucket        BOOK_S3_BUCKET
     --prefix        BOOK_S3_PREFIX                 (default: dancingsquared_book)
     --distribution  BOOK_CLOUDFRONT_DISTRIBUTION_ID   (optional)

   Nothing here is repo-specific: point it at a staging bucket just as easily.
*/

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SITE = resolve(ROOT, 'book', 'dancingsquared_book');

// Files that must never be served from a long-lived cache.
const VOLATILE = ['*.html', 'sw.js'];

// Everything not in VOLATILE. Kept modest (1 hour) rather than `immutable`,
// because the book's filenames are not content-hashed: a changed lib/*.js or
// formation PNG reuses its name, so a hard forever-cache would strand readers.
const ASSET_CACHE = 'public, max-age=3600';
const VOLATILE_CACHE = 'no-cache';

function parseArgs(argv) {
  const flags = new Set();
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      opts[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts[name] = next;
        i++;
      } else {
        flags.add(name);
      }
    }
  }
  return { flags, opts };
}

const USAGE = `
Publish the built book to S3.

  npm run deploy:book -- --bucket <bucket> [options]

Options:
  --bucket <name>          target S3 bucket                (env BOOK_S3_BUCKET)
  --prefix <key>           key prefix                      (env BOOK_S3_PREFIX, default dancingsquared_book)
  --distribution <id>      CloudFront distribution to invalidate
                                                           (env BOOK_CLOUDFRONT_DISTRIBUTION_ID)
  --no-delete              keep objects in S3 that no longer exist in the build
  --dryrun                 pass --dryrun to every aws call (nothing is written)
  --allow-root             permit an empty --prefix (uploads to the bucket root)
  --help                   show this message
`;

function fail(message) {
  console.error(`\n  error: ${message}\n`);
  process.exit(1);
}

function aws(args, { dryrun }) {
  const full = dryrun ? [...args, '--dryrun'] : args;
  const r = spawnSync('aws', full, { stdio: 'inherit' });
  if (r.error) {
    if (r.error.code === 'ENOENT') {
      fail('the AWS CLI (`aws`) is not on PATH. Install AWS CLI v2, then run `aws configure`.');
    }
    fail(`could not run the AWS CLI: ${r.error.message}`);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));

  if (flags.has('help')) {
    console.log(USAGE);
    return;
  }

  const bucket = opts.bucket || process.env.BOOK_S3_BUCKET;
  const prefix = (opts.prefix || process.env.BOOK_S3_PREFIX || 'dancingsquared_book')
    .replace(/^\/+|\/+$/g, '');
  const distribution = opts.distribution || process.env.BOOK_CLOUDFRONT_DISTRIBUTION_ID;
  const dryrun = flags.has('dryrun');
  const del = !flags.has('no-delete');

  if (!bucket) fail('no bucket given. Pass --bucket <name> or set BOOK_S3_BUCKET.');
  if (!prefix && !flags.has('allow-root')) {
    fail('the prefix is empty, which would sync over the whole bucket root. Pass --allow-root to mean it.');
  }
  if (!existsSync(SITE) || !statSync(SITE).isDirectory()) {
    fail(`no built site at ${SITE}. Run \`npm run build:book\` first.`);
  }
  if (!existsSync(resolve(SITE, 'index.html'))) {
    fail(`${SITE} has no index.html - it does not look like a built site. Run \`npm run build:book\`.`);
  }

  const dest = `s3://${bucket}/${prefix ? prefix + '/' : ''}`;

  console.log('\n  Dancing Squared - publish the book');
  console.log(`  from : ${SITE}`);
  console.log(`  to   : ${dest}`);
  console.log(`  sw   : ${prefix ? prefix + '/sw.js' : 'sw.js'}`);
  console.log(`  cf   : ${distribution || '(no distribution - skipping invalidation)'}`);
  console.log(`  mode : ${dryrun ? 'DRY RUN (nothing written)' : del ? 'sync with --delete' : 'sync (no delete)'}\n`);

  // --- 1. authenticated? -----------------------------------------------------
  aws(['sts', 'get-caller-identity', '--output', 'text'], { dryrun: false });

  const syncBase = ['s3', 'sync', SITE, dest];
  if (del) syncBase.push('--delete');

  // --- 2. bulk assets --------------------------------------------------------
  // --exclude filters are evaluated left to right; the volatile files are the
  // only exclusions, so everything else is uploaded in this pass.
  console.log('\n  [1/4] syncing assets ...');
  aws([...syncBase, '--cache-control', ASSET_CACHE, ...VOLATILE.flatMap((g) => ['--exclude', g])], { dryrun });

  // --- 3. volatile files -----------------------------------------------------
  // `--exclude "*"` then `--include` the volatile set: only those are in scope,
  // so --delete cannot touch the assets uploaded above.
  console.log('\n  [2/4] syncing pages and the service worker (no-cache) ...');
  aws(
    [...syncBase, '--cache-control', VOLATILE_CACHE, '--exclude', '*', ...VOLATILE.flatMap((g) => ['--include', g])],
    { dryrun }
  );

  // --- 4. the manifest needs its real Content-Type ---------------------------
  console.log('\n  [3/4] uploading manifest.webmanifest as application/manifest+json ...');
  aws(
    [
      's3', 'cp',
      resolve(SITE, 'manifest.webmanifest'),
      dest + 'manifest.webmanifest',
      '--content-type', 'application/manifest+json',
      '--cache-control', VOLATILE_CACHE,
    ],
    { dryrun }
  );

  // --- 5. CloudFront ---------------------------------------------------------
  if (distribution) {
    console.log('\n  [4/4] invalidating CloudFront ...');
    aws(
      [
        'cloudfront', 'create-invalidation',
        '--distribution-id', distribution,
        '--paths', prefix ? `/${prefix}/*` : '/*',
      ],
      { dryrun }
    );
  } else {
    console.log('\n  [4/4] no CloudFront distribution configured - skipped.');
  }

  console.log(dryrun ? '\n  Dry run finished. Nothing was written.\n' : '\n  Done.\n');
}

main();
