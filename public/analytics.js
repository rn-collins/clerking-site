/**
 * analytics.js — Clerking Client-Side Analytics v1
 * Covers: S1 (UTM/traffic) · S3 (scroll/CTA/session/feature) · S9 (JS errors/form errors)
 *         S10 (GA4 + Microsoft Clarity) · S11 (device) · S12 (A/B testing) · S13 (time-based)
 *
 * Add to every page: <script src="/analytics.js"></script>
 * Sends events to /api/events and augments form submissions with analytics metadata
 *
 * Respects: no tracking of sensitive input values, no PII beyond what user submits in form
 */
(function() {
  'use strict';

  const EVENTS_URL  = '/api/events';
  const AB_URL      = '/api/ab';
  const LEAD_URL    = '/api/lead';           // not called here — just for metadata injection

  // ── GA4 + MICROSOFT CLARITY INITIALIZATION (Section 10) ──────────────────
  // Set NEXT_PUBLIC_GA_MEASUREMENT_ID and NEXT_PUBLIC_CLARITY_PROJECT_ID env vars
  // Since this is a static HTML file, replace these at build time or use window vars
  const GA4_ID      = window.__CLERKING_GA4_ID      || '';   // e.g. 'G-XXXXXXXXXX'
  const CLARITY_ID  = window.__CLERKING_CLARITY_ID  || '';   // e.g. 'abcde12345'

  if (GA4_ID) {
    const s = document.createElement('script');
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
    s.async = true;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID, { send_page_view: true });
  }

  if (CLARITY_ID) {
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window,document,"clarity","script",CLARITY_ID);
  }

  // ── VISITOR + SESSION IDENTITY (Section 11 — returning visitor) ───────────
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random()*16|0;
      return (c==='x' ? r : (r&0x3|0x8)).toString(16);
    });
  }

  let visitorId = localStorage.getItem('ck_vid');
  if (!visitorId) {
    visitorId = uuid();
    localStorage.setItem('ck_vid', visitorId);
  }
  const isNewVisitor = !localStorage.getItem('ck_returning');
  localStorage.setItem('ck_returning', '1');

  const sessionId = sessionStorage.getItem('ck_sid') || uuid();
  sessionStorage.setItem('ck_sid', sessionId);
  const sessionStart = parseInt(sessionStorage.getItem('ck_start') || Date.now());
  sessionStorage.setItem('ck_start', sessionStart);

  // Pages viewed this session
  const pagesViewed = parseInt(sessionStorage.getItem('ck_pages') || 0) + 1;
  sessionStorage.setItem('ck_pages', pagesViewed);

  // ── UTM EXTRACTION (Section 1 — UTM parameter tracking) ─────────────────
  const params = new URLSearchParams(window.location.search);
  const utmKeys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  const utm = {};
  let hasUtm = false;
  utmKeys.forEach(k => {
    const v = params.get(k);
    if (v) { utm[k] = v; hasUtm = true; }
  });

  // Persist UTMs for multi-page sessions (Section 1 — multi-touch)
  if (hasUtm) {
    sessionStorage.setItem('ck_utm', JSON.stringify(utm));
  }
  const storedUtm = JSON.parse(sessionStorage.getItem('ck_utm') || '{}');
  const activeUtm = hasUtm ? utm : storedUtm;

  // Infer traffic source
  const referrer = document.referrer || '';
  const trafficSource = (() => {
    if (activeUtm.utm_source) return activeUtm.utm_source;
    if (!referrer) return 'direct';
    if (referrer.includes('linkedin.com')) return 'linkedin';
    if (referrer.includes('google.com'))   return 'google';
    if (referrer.includes('rncollins.com')) return 'rncollins';
    return 'referral';
  })();

  // Landing page (first page in session)
  if (!sessionStorage.getItem('ck_landing')) {
    sessionStorage.setItem('ck_landing', window.location.pathname + window.location.search);
  }
  const landingPage = sessionStorage.getItem('ck_landing');

  // ── CORE EVENT SENDER ─────────────────────────────────────────────────────
  function send(type, data) {
    const payload = {
      type,
      visitorId, sessionId, isNewVisitor,
      trafficSource,
      referrer,
      landingPage,
      page: window.location.pathname,
      ...activeUtm,
      ...data,
    };
    // Fire and forget — don't block UI
    navigator.sendBeacon
      ? navigator.sendBeacon(EVENTS_URL, JSON.stringify(payload))
      : fetch(EVENTS_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload), keepalive: true });

    // Also send to GA4 if loaded (Section 10)
    if (window.gtag && type !== 'pageview') {
      try { window.gtag('event', type, data); } catch(_) {}
    }
  }

  // ── SECTION 1 + 11: PAGEVIEW ─────────────────────────────────────────────
  send('pageview', {
    title:      document.title,
    isNewVisitor,
    pagesViewed,
    browser:    (()=>{
      const ua = navigator.userAgent;
      if (/chrome/i.test(ua) && !/edge/i.test(ua)) return 'chrome';
      if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'safari';
      if (/firefox/i.test(ua)) return 'firefox';
      return 'other';
    })(),
    os:       /iphone|ipad|mac/i.test(navigator.userAgent) ? 'apple'
            : /android/i.test(navigator.userAgent) ? 'android'
            : /windows/i.test(navigator.userAgent) ? 'windows' : 'other',
    screenW:  window.screen.width,
    screenH:  window.screen.height,
    language: navigator.language,
  });

  // ── SECTION 3: SCROLL DEPTH ──────────────────────────────────────────────
  let maxScroll = 0;
  const scrollMilestones = new Set();

  function getScrollPct() {
    const el = document.documentElement;
    const scrolled = el.scrollTop || document.body.scrollTop;
    const total = el.scrollHeight - el.clientHeight;
    return total > 0 ? Math.round((scrolled / total) * 100) : 0;
  }

  window.addEventListener('scroll', function() {
    const pct = getScrollPct();
    if (pct > maxScroll) maxScroll = pct;
    [25, 50, 75, 100].forEach(milestone => {
      if (pct >= milestone && !scrollMilestones.has(milestone)) {
        scrollMilestones.add(milestone);
        send('scroll_depth', { depth: milestone, page: window.location.pathname });
      }
    });
  }, { passive: true });

  // ── SECTION 3: CTA CLICK TRACKING ────────────────────────────────────────
  // Tracks all elements with data-cta attribute or matching common CTA patterns
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-cta], a[href*="gumroad"], a[href*="linkedin"], a[href*="mailto"], button');
    if (!el) return;

    const cta = el.dataset?.cta
      || (el.href?.includes('gumroad')   ? 'gumroad_link'    : null)
      || (el.href?.includes('linkedin')  ? 'linkedin_link'   : null)
      || (el.href?.includes('mailto')    ? 'email_link'      : null)
      || (el.tagName === 'BUTTON' ? 'button_' + (el.textContent?.trim().slice(0,20).replace(/\s+/g,'_').toLowerCase() || 'unnamed') : null);

    if (!cta) return;

    send('cta_click', {
      cta,
      label:     el.textContent?.trim().slice(0,100) || '',
      href:      el.href || '',
      scrollPct: maxScroll,
    });

    // External link tracking (Section 4 — content, Section 10 — competitive)
    if (el.href && !el.href.startsWith(window.location.origin)) {
      send('link_click', { destination: el.href.split('?')[0] });
    }
  });

  // ── SECTION 3: FORM OPEN TRACKING ────────────────────────────────────────
  function trackFormOpen(formEl) {
    send('form_open', {
      formId:    formEl?.id || formEl?.dataset?.formId || 'unknown',
      scrollPct: maxScroll,
      timeOnPage: Date.now() - sessionStart,
    });
  }

  // Listen for focus on any input (first focus = form open)
  let formOpenFired = {};
  document.addEventListener('focusin', function(e) {
    if (!e.target.matches('input, textarea, select')) return;
    const form = e.target.closest('form') || e.target.parentElement;
    const formKey = form?.id || 'main';
    if (!formOpenFired[formKey]) {
      formOpenFired[formKey] = true;
      trackFormOpen(form);
    }
  });

  // ── SECTION 3: FEATURE INTERACTION ───────────────────────────────────────
  // Attach to elements with data-feature attribute
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-feature]');
    if (!el) return;
    send('feature', {
      feature: el.dataset.feature,
      action:  el.dataset.action || 'click',
      label:   el.textContent?.trim().slice(0,80) || '',
    });
  });

  // ── SECTION 9: JS ERROR TRACKING ─────────────────────────────────────────
  window.onerror = function(message, source, lineno, colno, error) {
    send('js_error', {
      message: String(message).slice(0, 300),
      source:  source?.replace(window.location.origin, '').slice(0, 100) || '',
      lineno,
      colno,
      stack:   error?.stack?.slice(0, 500) || '',
      url:     window.location.pathname,
    });
    return false; // Don't suppress default error handling
  };

  window.addEventListener('unhandledrejection', function(e) {
    send('js_error', {
      message: 'UnhandledPromiseRejection: ' + String(e.reason).slice(0, 200),
      url:     window.location.pathname,
    });
  });

  // ── SECTION 12: A/B TEST ASSIGNMENT ─────────────────────────────────────
  let abAssignments = {};
  (async function loadAbTests() {
    try {
      const r = await fetch(`${AB_URL}?visitorId=${encodeURIComponent(visitorId)}`);
      const j = await r.json();
      abAssignments = j.assignments || {};

      // Fire impression events for all tests
      Object.entries(abAssignments).forEach(([testName, { variant }]) => {
        send('ab_impression', { testName, variant });
      });

      // Expose to window for page code to use
      window.clerkingAB = abAssignments;
      window.dispatchEvent(new CustomEvent('clerking:ab_ready', { detail: abAssignments }));

      // Apply A/B test variants to DOM
      applyAbVariants(abAssignments);
    } catch(_) {}
  })();

  function applyAbVariants(assignments) {
    // CTA copy
    if (assignments.cta_copy?.value) {
      document.querySelectorAll('[data-ab-cta]').forEach(el => {
        el.textContent = assignments.cta_copy.value;
      });
    }
    // Headline
    if (assignments.headline?.value) {
      const h = document.querySelector('[data-ab-headline]');
      if (h) h.textContent = assignments.headline.value;
    }
    // Social proof placement
    if (assignments.social_proof?.value === 'above_cta') {
      const sp = document.getElementById('social-proof');
      const cta = document.getElementById('main-cta');
      if (sp && cta && cta.parentNode) {
        cta.parentNode.insertBefore(sp, cta);
      }
    }
    // Form length — short vs medium
    if (assignments.form_length?.value === 'short') {
      document.querySelectorAll('[data-ab-field="message"]').forEach(el => {
        el.style.display = 'none';
      });
    }
  }

  // ── ANALYTICS METADATA INJECTION ─────────────────────────────────────────
  // Inject analytics context into any form submission so lead.js gets full data
  function buildAnalyticsMeta() {
    return {
      utm_source:   activeUtm.utm_source   || '',
      utm_medium:   activeUtm.utm_medium   || '',
      utm_campaign: activeUtm.utm_campaign || '',
      utm_content:  activeUtm.utm_content  || '',
      utm_term:     activeUtm.utm_term     || '',
      referrer,
      landing_page:  landingPage,
      session_id:    sessionId,
      visitor_id:    visitorId,
      time_on_page:  Date.now() - sessionStart,
      scroll_depth:  maxScroll,
      cta_path:      sessionStorage.getItem('ck_last_cta') || '',
      pages_viewed:  pagesViewed,
      is_new_visitor: isNewVisitor,
    };
  }

  // Intercept fetch calls to /api/lead to inject analytics metadata
  const origFetch = window.fetch;
  window.fetch = function(url, opts) {
    if (typeof url === 'string' && url.includes('/api/lead')) {
      try {
        const body = JSON.parse(opts?.body || '{}');
        body._analytics = buildAnalyticsMeta();
        opts = { ...opts, body: JSON.stringify(body) };

        // Fire form_submit event
        send('form_submit', { scrollPct: maxScroll, timeOnPage: Date.now() - sessionStart });

        // Record CTA path for A/B conversion
        const lastCta = sessionStorage.getItem('ck_last_cta') || '';
        if (lastCta && abAssignments.cta_copy) {
          send('ab_conversion', { testName: 'cta_copy', variant: abAssignments.cta_copy.variant });
        }
      } catch(_) {}
    }
    return origFetch.call(this, url, opts);
  };

  // Track last CTA clicked
  document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-cta]');
    if (el?.dataset?.cta) {
      sessionStorage.setItem('ck_last_cta', el.dataset.cta);
    }
  });

  // ── SECTION 13: SESSION END / TIME ON PAGE ────────────────────────────────
  function fireSessionEnd() {
    const converted = sessionStorage.getItem('ck_converted') === '1';
    send('session_end', {
      duration:    Date.now() - sessionStart,
      pagesViewed,
      converted,
      maxScroll,
    });
  }

  // Fire on tab close / navigate away
  window.addEventListener('beforeunload', fireSessionEnd);
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') fireSessionEnd();
  });

  // Mark session as converted when lead form is submitted
  document.addEventListener('clerking:form_submitted', function() {
    sessionStorage.setItem('ck_converted', '1');
  });

  // ── EXPOSE UTILITIES TO PAGE CODE ────────────────────────────────────────
  window.clerkingAnalytics = {
    track:        send,
    getVisitorId: () => visitorId,
    getSessionId: () => sessionId,
    getTrafficSource: () => trafficSource,
    getUtm:       () => activeUtm,
    getScrollDepth: () => maxScroll,
    getMeta:      buildAnalyticsMeta,
    trackConversion: () => {
      sessionStorage.setItem('ck_converted', '1');
      send('form_submit', { scrollPct: maxScroll, timeOnPage: Date.now() - sessionStart });
    },
    trackFeature: (feature, action, label='') => send('feature', { feature, action, label }),
    reportFormError: (formId, errMsg) => send('form_error', { formId, error: errMsg }),
  };

  // ── SECTION 10: UPTIME PING (lightweight, every 30 min if tab active) ────
  // Passive — the real uptime check is via UptimeRobot → /api/health
  // This supplements with actual user-observed latency
  let uptimePingInterval = null;
  function startUptimePing() {
    if (uptimePingInterval) return;
    uptimePingInterval = setInterval(async () => {
      try {
        const start = Date.now();
        await fetch('/api/health');
        const latency = Date.now() - start;
        send('feature', { feature: 'uptime', action: 'ping_ok', label: String(latency) + 'ms' });
      } catch {
        send('feature', { feature: 'uptime', action: 'ping_fail' });
      }
    }, 30 * 60 * 1000); // every 30 min
  }
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') startUptimePing();
  });
  if (document.visibilityState === 'visible') startUptimePing();

})();