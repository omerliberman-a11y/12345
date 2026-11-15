/* System Compare — contact form (/contact/).
 *
 * Network behaviour is identical to the previous site's contact-form.js:
 *   1. Ticking the consent box requests a challenge:   POST {endpoint}challenge  {site, locale, pageUrl, consent:true}
 *   2. The form may be sent no sooner than max(3 s, the server's minSubmitAt).
 *   3. Submit:                                          POST {endpoint}submit     {…context, challenge, name, email, topic, message, website}
 * Requests are JSON, credentials omitted, never cached, sent without a referrer, and time out after 30 s.
 * "website" is a honeypot that people never see. Nothing is sent before the privacy consent is given.
 * The endpoint, the context and every message come from the page configuration (#page-data → contact).
 *
 * Added here: field-level error messages (aria-invalid + described-by text), a hint while the button is
 * still disabled, and ?topic=correction|privacy|… to preselect a topic from links on other pages.
 */
(function () {
  'use strict';
  var d = document;
  var form = d.querySelector('form[data-contact-form]');
  var dataEl = d.getElementById('page-data');
  if (!form || !dataEl || form.getAttribute('data-contact-mounted')) return;
  var config;
  try { config = JSON.parse(dataEl.textContent).contact; } catch (e) { return; }
  if (!config || !config.endpoint || !config.copy) return;
  form.setAttribute('data-contact-mounted', 'true');

  var copy = config.copy;
  var endpoint = config.endpoint;
  var context = { site: config.site, locale: config.locale, pageUrl: config.pageUrl, consent: true };
  var consent = form.elements.consent;
  var button = form.querySelector('[type="submit"]');
  var status = d.getElementById('contact-status');
  var fields = ['name', 'email', 'topic', 'message'].map(function (n) { return form.elements[n]; });
  var HINT = 'Tick the consent box to prepare the form for sending.';
  var FIELD_ERRORS = {
    name: 'Enter your name.',
    email: 'Enter an email address we can reply to, like name@example.com.',
    topic: 'Choose a topic.',
    message: 'Write your message.'
  };

  var challenge = null, sequence = 0, timer = null, busy = false, accepted = false, controller = null, submitPending = false, challengeAttempted = false;

  // ------------------------------------------------------------------ status line
  function announce(message, error, focus) {
    status.textContent = message;
    status.setAttribute('data-error', String(!!error));
    status.setAttribute('role', error ? 'alert' : 'status');
    if (focus) status.focus();
  }
  function unlock() {
    clearTimeout(timer);
    if (accepted) return;
    button.disabled = !consent.checked || busy;
    button.textContent = copy.submit;
  }
  /** Milliseconds until a server timestamp (seconds, milliseconds or ISO string); 3 s when unreadable. */
  function msUntil(value) {
    var ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
    return isFinite(ms) ? Math.max(0, ms - Date.now()) : 3000;
  }

  // ------------------------------------------------------------------ transport
  function request(route, payload, signal) {
    // 30 s timeout combined with the caller's abort signal (same effect as AbortSignal.any([signal, timeout]))
    var guard = new AbortController(), timedOut = false;
    var t = setTimeout(function () { timedOut = true; guard.abort(); }, 30000);
    if (signal) {
      if (signal.aborted) guard.abort();
      else signal.addEventListener('abort', function () { guard.abort(); }, { once: true });
    }
    return fetch(endpoint + route, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: guard.signal
    }).then(function (response) {
      return response.json().then(
        function (data) { return { response: response, data: data }; },
        function () { throw { code: 'service_unavailable' }; }
      );
    }).then(function (r) {
      clearTimeout(t);
      var data = r.data || {};
      if (!r.response.ok || data.ok !== true) {
        var err = {}, src = data.error || {}, k;
        for (k in src) err[k] = src[k];
        err.requestId = data.requestId;
        err.retryAfterSeconds = data.retryAfterSeconds != null ? data.retryAfterSeconds : src.retryAfterSeconds;
        throw err;
      }
      return data;
    }, function (error) {
      clearTimeout(t);
      // Only an abort by the caller (consent withdrawn, newer request) is silent; a timeout is a failure.
      if (signal && signal.aborted && !timedOut) throw { name: 'AbortError' };
      if (timedOut) throw { code: 'timeout' };
      throw error && error.name === 'AbortError' ? { code: 'network_error' } : error;
    });
  }
  function failure(error) {
    var code = error && error.code;
    if (code === 'rate_limited') return copy.rate;
    if (code === 'challenge_used') return copy.duplicate;
    if (code === 'spam_rejected') return copy.spam;
    if (code === 'too_fast') return copy.wait;
    if (code === 'challenge_expired' || code === 'challenge_invalid') return copy.expired;
    if (['consent_required', 'invalid_name', 'invalid_email', 'invalid_topic', 'invalid_message', 'invalid_fields'].indexOf(code) >= 0) return copy.required;
    return copy.error;
  }

  // ------------------------------------------------------------------ step 1: challenge (only after consent)
  function prepare() {
    if (!consent.checked || accepted || submitPending || challengeAttempted) return Promise.resolve(false);
    var current = ++sequence;
    if (controller) controller.abort();
    controller = new AbortController();
    busy = true; button.disabled = true; announce(copy.preparing);
    return request('challenge', context, controller.signal).then(function (data) {
      if (current !== sequence || !consent.checked) return false;
      if (typeof data.challenge !== 'string' || !data.challenge) throw { code: 'service_unavailable' };
      challenge = data; busy = false;
      var delay = Math.max(3000, msUntil(data.minSubmitAt));
      announce(copy.wait);
      timer = setTimeout(function () { if (current === sequence && consent.checked) { unlock(); announce(copy.ready); } }, delay);
      return true;
    }).catch(function (error) {
      if (current !== sequence || (error && error.name === 'AbortError')) return false;
      challenge = null; busy = false; unlock(); announce(failure(error), true);
      return false;
    });
  }
  consent.addEventListener('change', function () {
    // Consent changes cannot replace a token whose delivery is in flight or uncertain.
    if (accepted || submitPending) { button.disabled = true; return; }
    if (challengeAttempted) { unlock(); return; }
    sequence++; clearTimeout(timer); if (controller) controller.abort(); challenge = null; busy = false;
    if (consent.checked) prepare(); else { button.disabled = true; announce(HINT); }
  });

  // ------------------------------------------------------------------ field errors
  function errorNode(field) {
    var id = field.id + '-error', node = d.getElementById(id);
    if (!node) {
      node = d.createElement('p');
      node.id = id; node.className = 'error';
      field.parentNode.appendChild(node);
      var described = field.getAttribute('aria-describedby');
      field.setAttribute('aria-describedby', described ? described + ' ' + id : id);
    }
    return node;
  }
  function setFieldError(field, message) {
    if (message) { field.setAttribute('aria-invalid', 'true'); errorNode(field).textContent = message; }
    else {
      field.removeAttribute('aria-invalid');
      var node = d.getElementById(field.id + '-error');
      if (node) node.textContent = '';
    }
  }
  function validate() {
    var first = null;
    fields.forEach(function (field) {
      var ok = field.checkValidity() && String(field.value).trim() !== '';
      setFieldError(field, ok ? '' : FIELD_ERRORS[field.name]);
      if (!ok && !first) first = field;
    });
    if (first) first.focus();
    return !first;
  }
  fields.forEach(function (field) {
    field.addEventListener('input', function () { if (field.hasAttribute('aria-invalid')) setFieldError(field, ''); });
  });

  // ------------------------------------------------------------------ step 2: submit
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (busy || accepted || submitPending) return;
    if (!consent.checked || !validate()) { announce(copy.required, true); return; }
    if (!challenge) { prepare(); return; }
    if (msUntil(challenge.minSubmitAt) > 0) { announce(copy.wait, true); return; }
    busy = true; submitPending = true; challengeAttempted = true; consent.disabled = true; button.disabled = true;
    button.textContent = copy.sending; announce(copy.sending);
    // This request starts only after explicit privacy consent and a server-issued challenge.
    var payload = { site: context.site, locale: context.locale, pageUrl: context.pageUrl, consent: true, challenge: challenge.challenge,
      name: form.elements.name.value.trim(), email: form.elements.email.value.trim(), topic: form.elements.topic.value,
      message: form.elements.message.value.trim(), website: form.elements.website.value };
    request('submit', payload).then(function (result) {
      if (result.status !== 'accepted') throw { code: 'delivery_failed' };
      accepted = true; submitPending = false; form.reset();
      Array.prototype.forEach.call(form.elements, function (element) { element.disabled = true; });
      button.textContent = copy.submit; announce(copy.success, false, true);
    }).catch(function (error) {
      var code = error && error.code;
      if (code === 'challenge_expired' || code === 'challenge_invalid') { challenge = null; challengeAttempted = false; }
      submitPending = false; consent.disabled = false; busy = false;
      if (code === 'challenge_used') { accepted = true; button.disabled = true; button.textContent = copy.submit; } else unlock();
      announce(failure(error), true, true);
      // Log identifiers only; never copy visitor details or the message into the console.
      if (window.console && console.warn) console.warn('System Compare contact delivery failed', { code: code || 'network_error', requestId: (error && error.requestId) || null });
    });
  });

  // ------------------------------------------------------------------ start
  // Deep links from other pages: /contact/?topic=correction
  try {
    var topic = new URLSearchParams(location.search).get('topic');
    if (topic && Array.prototype.some.call(form.elements.topic.options, function (o) { return o.value === topic; })) form.elements.topic.value = topic;
  } catch (e) { /* older browsers: keep the default topic */ }
  // A box restored as ticked by the browser (back/forward) is cleared: the challenge is requested only
  // when the visitor gives consent in this visit, exactly as before.
  function reset() {
    if (consent.checked && !challenge && !busy && !accepted && !challengeAttempted) consent.checked = false;
    if (!consent.checked && !accepted && !status.textContent) announce(HINT);
  }
  reset();
  window.addEventListener('pageshow', reset);
})();
