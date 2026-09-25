// SAVE THE WHOLE BOOK, IN ONE GO.
//
// WHY THIS FILE EXISTS. The service worker used to cache as it went: pages came from the network,
// figures and animations entered the cache the first time a reader viewed them, and a new build
// activated a new cache while a reader was mid-session. A reader therefore read a MIXTURE -- new pages
// beside a stylesheet and figures from the previous build -- and the book looked different depending
// on which pages they happened to have opened. The deploy was correct; the BROWSER was assembling the
// book in stages.
//
// So nothing enters the offline store by accident any more. The service worker only READS it (see
// `lib/app.mjs`: no precache, no cache-as-you-view), and this file is the only thing that WRITES it,
// from a list the build produced. The store is marked complete only after the last file lands, and the
// worker ignores an unmarked store -- so an interrupted download can never become the copy a reader is
// served, and a half-downloaded book cannot exist.
//
// WHAT IT IS NOT. Not a module: it is loaded with `defer` on every page as a CLASSIC script, so it
// runs on `file://` too (where it hides itself, because there is no Cache Storage there) and so it
// needs no build step of its own. And it does not touch the page: it owns one button in the nav and
// one panel, and everything else is the reader's.
(function () {
  'use strict';

  // ---- where this file is, and what it is next to ------------------------------------------------
  //
  // Taken from the script tag's own data attributes rather than derived from the URL: `rel` differs
  // between the front door and a page in a subdirectory, and the build knows which is which. Guessing
  // it here would put the manifest one directory wrong on exactly the deep pages nobody tests by hand.
  var self = document.currentScript || document.querySelector('script[data-dsq-offline]');
  if (!self) return;
  var ROOT_HREF = new URL(self.dataset.root || './', location.href).href;
  // RESOLVED AGAINST THE SITE ROOT, NOT THE PAGE. `download.json` sits at the top of the book, so a
  // page in a subdirectory that asked for it by name alone would look for its own copy beside itself
  // and find nothing -- on exactly the deep pages nobody opens by hand.
  var MANIFEST_HREF = new URL(self.dataset.manifest || 'download.json', ROOT_HREF).href;

  // The store's name carries the build it holds. One prefix, so this book never touches another
  // application's caches on the same origin (the host serves more than this book).
  var PREFIX = 'dsq-offline-';
  // A store counts as USABLE only when this marker is inside it. It is written last, after every file
  // has landed, which is what makes a download all-or-nothing without a rename Cache Storage does not
  // have.
  var MARKER = '__complete';

  var btn = document.querySelector('nav.nav button.offline');
  // No button (a page built before this existed) or no Cache Storage (a `file://` copy, an old
  // browser, a locked-down profile): stay hidden. A control that cannot work is worse than no control.
  if (!btn || !('caches' in window)) return;

  var busy = false;
  var panel = null;

  // ---- the store ---------------------------------------------------------------------------------

  function markerUrl() {
    return new URL(MARKER, ROOT_HREF).href;
  }

  /** The complete store, if there is one: `{ name, version }`, or null. */
  function installed() {
    return caches.keys().then(function (keys) {
      var mine = keys.filter(function (k) { return k.indexOf(PREFIX) === 0; });
      // Sequential rather than Promise.all: this runs on every page load, and it stops at the first
      // hit. There is at most one complete store, so the common case is one lookup.
      return mine.reduce(function (chain, k) {
        return chain.then(function (found) {
          if (found) return found;
          return caches.open(k).then(function (c) {
            return c.match(markerUrl()).then(function (hit) {
              return hit ? { name: k, version: k.slice(PREFIX.length) } : null;
            });
          });
        });
      }, Promise.resolve(null));
    });
  }

  /** Every store belonging to this book, complete or not. */
  function mine() {
    return caches.keys().then(function (keys) {
      return keys.filter(function (k) { return k.indexOf(PREFIX) === 0; });
    });
  }

  /**
   * The list of what the book is made of, straight from the network.
   *
   * `cache: 'no-store'` and a fresh query: this question is "what does the server have NOW", and both
   * a stale HTTP cache and the service worker's own store would answer it with what the reader already
   * has. The worker also passes this request straight through -- see the `no-store` rule in `sw.js` --
   * because a request that asks not to be cached must not be answered from a cache.
   */
  function live() {
    return fetch(MANIFEST_HREF + '?check=' + Date.now(), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('the list of contents could not be fetched (HTTP ' + res.status + ')');
      return res.json();
    });
  }

  // ---- reading a response, counting it as it arrives ---------------------------------------------
  //
  // The bytes are counted OFF THE WIRE rather than taken from the manifest, so the bar moves while a
  // large animation is arriving instead of jumping a file at a time. The manifest's size is still what
  // the bar is measured against, and each file's contribution is capped at its own size: a response
  // whose decoded length differs from the file on disk (any compressed page) would otherwise push the
  // total past 100%.
  function readThrough(res, onBytes) {
    if (!res.body || !res.body.getReader) {
      return res.arrayBuffer().then(function (buf) {
        onBytes(buf.byteLength);
        return new Response(buf, { headers: { 'content-type': typeOf(res) } });
      });
    }
    var reader = res.body.getReader();
    var chunks = [];
    var got = 0;
    var pump = function () {
      return reader.read().then(function (step) {
        if (step.done) {
          // Rebuilt from the bytes we counted, with the one header that matters: the file's type. The
          // original header set is NOT copied across, because it can carry a content-encoding the
          // already-decoded body no longer has.
          return new Response(new Blob(chunks, { type: typeOf(res) }), { headers: { 'content-type': typeOf(res) } });
        }
        chunks.push(step.value);
        got += step.value.length;
        onBytes(got);
        return pump();
      });
    };
    return pump();
  }

  function typeOf(res) {
    return res.headers.get('content-type') || 'application/octet-stream';
  }

  // ---- the download ------------------------------------------------------------------------------

  /**
   * Fetch every file the manifest names into the store for that build.
   *
   * RESUMABLE, AND THAT IS THE POINT OF THE MARKER. A file already in the store is not fetched again,
   * so pressing the button after an interrupted download continues rather than starting over. This is
   * only sound because the store is named after the build: its contents cannot be superseded without
   * the name changing too.
   *
   * The old complete store is deleted only AFTER the marker is written, so at no point is there no
   * usable copy: a reader who is offline in the middle of an update still has the edition they had.
   */
  function download(manifest, onProgress) {
    var store = PREFIX + manifest.version;
    var total = manifest.total || manifest.files.reduce(function (a, f) { return a + f.size; }, 0);
    var doneBytes = 0;
    var cache = null;
    return caches
      .open(store)
      .then(function (c) {
        cache = c;
        return manifest.files.reduce(function (chain, file, i) {
          return chain.then(function () {
            var url = new URL(file.path, ROOT_HREF).href;
            var start = doneBytes;
            var report = function (got) {
              // This file's share of the bar, capped at its own size.
              onProgress(start + Math.min(got, file.size || got), total, file.path, i, manifest.files.length);
            };
            return cache.match(url).then(function (have) {
              if (have) {
                doneBytes += file.size;
                onProgress(doneBytes, total, file.path, i + 1, manifest.files.length);
                return;
              }
              return fetch(url, { cache: 'no-store' }).then(function (res) {
                if (!res.ok) throw new Error(file.path + ' could not be fetched (HTTP ' + res.status + ')');
                return readThrough(res, report).then(function (storable) {
                  return cache.put(url, storable);
                });
              }).then(function () {
                doneBytes += file.size;
                onProgress(doneBytes, total, file.path, i + 1, manifest.files.length);
              });
            });
          });
        }, Promise.resolve());
      })
      .then(function () {
        // LAST: the store becomes usable.
        return cache.put(
          markerUrl(),
          new Response(manifest.version, { headers: { 'content-type': 'text/plain' } }),
        );
      })
      .then(function () {
        return mine();
      })
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k !== store; }).map(function (k) { return caches.delete(k); }),
        );
      })
      .then(function () {
        return manifest.version;
      });
  }

  // ---- the panel ---------------------------------------------------------------------------------

  var STATE_TEXT = {
    absent: 'This book is not saved on this device yet.',
    current: 'Saved on this device. You can read it with no connection.',
    stale: 'A newer edition of this book is available.',
    busy: 'Saving the book for offline reading.',
    failed: 'The download did not finish.',
    offline: 'No connection, so the book cannot be checked or downloaded.',
    // THE STATE THAT ONLY EXISTS WHEN THERE IS ALREADY A BOOK. A failed CHECK is not a failed
    // DOWNLOAD, and saying "the download did not finish" to a reader who is reading the saved copy on
    // a train is simply untrue. With a copy in hand the only thing lost is knowing whether a newer
    // edition is published, and this says exactly that.
    saved: 'Saved on this device. The server could not be reached to check for a newer edition.',
  };

  function openPanel() {
    if (panel) {
      panel.hidden = false;
      place();
      return panel;
    }
    panel = document.createElement('div');
    panel.className = 'dsq-dl';
    // NOT `role="dialog"`. It does not take focus and does not trap it, so announcing a dialog would
    // promise a reader something this does not do. It is a labelled group whose heading is a live
    // region, which is what it actually is: a place where the state of the download is said out loud.
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Offline reading');
    panel.innerHTML =
      '<p class="dsq-dl-head" aria-live="polite"></p>' +
      '<div class="dsq-dl-track"><span class="dsq-dl-fill"></span></div>' +
      '<p class="dsq-dl-detail"></p>' +
      '<div class="dsq-dl-actions"></div>';
    // INTO THE NAV, not the body. position:fixed takes it out of the row's layout either way, and
    // appending it here keeps it inside the page's own region rather than in a limb of the document
    // that a screen reader reaches only by leaving the article.
    btn.parentNode.appendChild(panel);
    panel.querySelector('.dsq-dl-actions').addEventListener('click', function (e) {
      var act = e.target.closest('button');
      if (!act) return;
      if (act.dataset.act === 'go') start();
      else if (act.dataset.act === 'reload') location.reload();
      else if (act.dataset.act === 'check') { closePanel(); check(); }
      else closePanel();
    });
    place();
    return panel;
  }

  /** Under the button, wherever the button happens to be -- the bar is pinned or not, wrapped or not. */
  function place() {
    if (!panel) return;
    var r = btn.getBoundingClientRect();
    var room = window.innerWidth - r.right;
    panel.style.top = Math.round(r.bottom + 6) + 'px';
    // Right-aligned to the button, but never off the left of a narrow screen.
    panel.style.right = Math.max(8, Math.round(room)) + 'px';
    panel.style.left = 'auto';
  }

  function closePanel() {
    if (panel) panel.hidden = true;
  }

  function setActions(list) {
    var box = openPanel().querySelector('.dsq-dl-actions');
    box.innerHTML = '';
    list.forEach(function (item) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      b.dataset.act = item.act;
      if (item.primary) b.className = 'primary';
      box.appendChild(b);
    });
  }

  function show(state, head, detail, pct) {
    openPanel();
    panel.dataset.state = state;
    panel.querySelector('.dsq-dl-head').textContent = head || STATE_TEXT[state] || '';
    panel.querySelector('.dsq-dl-detail').textContent = detail || '';
    var track = panel.querySelector('.dsq-dl-track');
    track.hidden = state !== 'busy';
    track.firstElementChild.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
    // The button carries the same state, so the nav shows what is happening without the panel. The
    // progress itself is announced by the bar, which is the thing that has a progressbar role.
    btn.dataset.state = state;
    btn.querySelector('.bar').setAttribute('aria-valuenow', String(Math.round(Math.max(0, Math.min(100, pct || 0)))));
    btn.title = head || STATE_TEXT[state] || '';
    btn.setAttribute('aria-label', (head || STATE_TEXT[state] || '') + ' Press for details.');
  }

  function mb(bytes) {
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ---- the button --------------------------------------------------------------------------------

  /** Put the button on screen for the first time, hidden until we know something worth saying. */
  function reveal(state) {
    btn.hidden = false;
    btn.dataset.state = state;
  }

  function check() {
    if (busy) return Promise.resolve();
    return installed().then(function (have) {
      return live().then(function (manifest) {
        // Housekeeping: a store that is neither the complete copy nor the build now on offer is the
        // wreckage of an abandoned attempt at some other build -- it can never be resumed and will
        // never be read, so it is only invisible storage.
        return mine().then(function (keys) {
          var keep = PREFIX + manifest.version;
          var keepComplete = have ? have.name : null;
          return Promise.all(
            keys
              .filter(function (k) { return k !== keep && k !== keepComplete; })
              .map(function (k) { return caches.delete(k); }),
          ).then(function () { return { have: have, manifest: manifest }; });
        });
      });
    }).then(function (r) {
      var have = r.have;
      var manifest = r.manifest;
      var short = manifest.version.slice(0, 7);
      if (have && have.version === manifest.version) {
        reveal('current');
        btn.title = 'Saved on this device, and up to date. Press for details.';
        btn.setAttribute('aria-label', btn.title);
      } else if (have) {
        // THE PENDING DOWNLOAD, and the only state that shouts: the reader has an edition, a newer one
        // is published, and nothing happens until they say so.
        reveal('stale');
        btn.title = 'A newer edition of this book is ready to download. Press to see it.';
        btn.setAttribute('aria-label', btn.title);
        if (panel && !panel.hidden) {
          show('stale', STATE_TEXT.stale, 'You have ' + have.version.slice(0, 7) + '; ' + short + ' is available. ' + mb(manifest.total) + '.', 0);
          setActions([{ label: 'Download', act: 'go', primary: true }, { label: 'Not now', act: 'close' }]);
        }
      } else {
        reveal('absent');
        btn.title = 'Save the whole book on this device for offline reading. Press for details.';
        btn.setAttribute('aria-label', btn.title);
      }
    }).catch(function (err) {
      // A failed check is not an error worth shouting about: it means offline, or a server that will
      // not answer. WHETHER THERE IS A SAVED COPY DECIDES WHAT IT MEANS, and the two readings could
      // hardly be further apart: with one, the reader can read the whole book and has merely lost the
      // news; without one, this is the state in which the book cannot be saved at all. The reason goes
      // with it either way -- "it did not work" is not something a reader can act on, and this is the
      // one place that knows which of the several possible reasons it was.
      if (busy) return;
      var why = err && err.message ? ' (' + err.message + ')' : '';
      return installed().then(function (have) {
        var state = have ? 'saved' : navigator.onLine ? 'failed' : 'offline';
        reveal(state);
        btn.title = STATE_TEXT[state] + why + ' Press for details.';
        btn.setAttribute('aria-label', btn.title);
      }, function () {
        var state = navigator.onLine ? 'failed' : 'offline';
        reveal(state);
        btn.title = STATE_TEXT[state] + why + ' Press for details.';
        btn.setAttribute('aria-label', btn.title);
      });
    });
  }

  var lastManifest = null;

  function start() {
    if (busy) return;
    busy = true;
    show('busy', 'Checking for the list of contents.', '', 0);
    setActions([{ label: 'Hide', act: 'close' }]);
    live()
      .then(function (manifest) {
        lastManifest = manifest;
        show('busy', 'Saving the book for offline reading.', 'Starting, ' + mb(manifest.total) + ' in ' + manifest.files.length + ' files.', 0);
        return download(manifest, function (done, total, path, i, n) {
          show(
            'busy',
            'Saving the book for offline reading.',
            mb(done) + ' of ' + mb(total) + ' \u00b7 file ' + Math.min(i + 1, n) + ' of ' + n + ' \u00b7 ' + path,
            total ? (done / total) * 100 : 0,
          );
        });
      })
      .then(function (version) {
        busy = false;
        var done = STATE_TEXT.current;
        show('current', 'The book is saved on this device.', done + ' Reload to read this edition.', 100);
        setActions([{ label: 'Reload', act: 'reload', primary: true }, { label: 'Close', act: 'close' }]);
        void version;
        return check();
      })
      .catch(function (err) {
        busy = false;
        var state = navigator.onLine ? 'failed' : 'offline';
        // Named, not summarised: "the download failed" tells a reader nothing they can act on, and the
        // one thing that IS actionable here is which file stopped it.
        show(state, STATE_TEXT[state], String((err && err.message) || err) + '. Nothing was changed \u2014 the copy you already had is still there.', 0);
        setActions([{ label: 'Try again', act: 'go', primary: true }, { label: 'Close', act: 'close' }]);
        btn.dataset.state = state;
        btn.title = STATE_TEXT[state] + ' Press for details.';
      });
  }

  btn.addEventListener('click', function () {
    // PRESSING THE BUTTON IS THE DOWNLOAD, when there is one to do. That is what the button is for and
    // what its label says, so it does not ask again through a second button in a panel -- a reader who
    // wanted to know more can close the panel, and one who wanted the book presses once.
    if (busy) {
      openPanel();
      return;
    }
    // `data-state` is the state the last check reached, so the press acts on what the reader can see
    // rather than on a fresh answer that may take a moment: pressing a button that says "a newer
    // edition is ready" should start fetching it, not start another question.
    if (btn.dataset.state === 'absent' || btn.dataset.state === 'stale') {
      start();
      return;
    }
    // Nothing to download, or the last attempt failed: the panel is where the state is explained, and
    // where a failed attempt offers itself again.
    installed().then(function (have) {
      return live().then(function (manifest) {
        var upToDate = have && have.version === manifest.version;
        if (upToDate) {
          show('current', 'Saved on this device, and up to date.', mb(manifest.total) + ' in ' + manifest.files.length + ' files.', 100);
          setActions([{ label: 'Close', act: 'close' }]);
        } else {
          show(
            have ? 'stale' : 'absent',
            have ? STATE_TEXT.stale : STATE_TEXT.absent,
            mb(manifest.total) + ' in ' + manifest.files.length + ' files.',
            0,
          );
          setActions([{ label: 'Download', act: 'go', primary: true }, { label: 'Close', act: 'close' }]);
        }
      });
    }).catch(function (err) {
      var state = navigator.onLine ? 'failed' : 'offline';
      show(state, STATE_TEXT[state], err && err.message ? err.message : '', 0);
      setActions([{ label: 'Try again', act: 'check', primary: true }, { label: 'Close', act: 'close' }]);
    });
  });

  // The panel is anchored to the button, which moves when the bar wraps, when the window resizes and
  // when the bar is pinned. Cheap to re-place on each of those, and it cannot then drift.
  addEventListener('resize', function () { if (panel && !panel.hidden) place(); });
  // A reader who goes offline mid-download should be told, and one who comes back should be offered
  // the download again without having to think about it.
  addEventListener('online', function () { if (!busy) check(); });
  addEventListener('offline', function () {
    if (busy) return;
    if (panel && !panel.hidden) show('offline', STATE_TEXT.offline, '', 0);
  });
  // Coming back to a long-open tab is exactly when a new edition is most likely to have appeared.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && !busy && navigator.onLine) check();
  });

  // Only now is there something true to say. Until this resolves the button stays hidden, so a reader
  // never sees a state that was guessed rather than measured.
  //
  // AND IT CANNOT STAY HIDDEN FOR EVER. A check that never answers -- a server that accepts the
  // connection and then says nothing is the usual way -- would otherwise leave the reader with no
  // control at all and no way to find out why, which is worse than the control admitting it failed.
  var settled = false;
  var watchdog = setTimeout(function () {
    if (settled) return;
    reveal('failed');
    btn.title = 'The book could not check for updates, so this may not be the newest edition. Press to try.';
    btn.setAttribute('aria-label', btn.title);
  }, 8000);

  try {
    check().then(function () { settled = true; }, function () { settled = true; });
  } catch (err) {
    // A throw before the first promise exists: nothing else would ever report it, and the reader
    // would be left looking at a page with no offline control and no explanation.
    settled = true;
    reveal('failed');
    btn.title = 'The offline downloader could not start: ' + (err && err.message ? err.message : err);
    btn.setAttribute('aria-label', btn.title);
  }
  void watchdog;
})();
