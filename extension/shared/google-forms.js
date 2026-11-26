export function isGoogleForms(url) {
  const page = new URL(url);
  return page.origin === 'https://docs.google.com' &&
    /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[\w-]+\/(?:viewform|formResponse)\/?$/.test(page.pathname);
}

export function sameSignupForm(a, b) {
  const first = new URL(a), second = new URL(b);
  if (first.origin !== second.origin) return false;
  if (!isGoogleForms(a) && !isGoogleForms(b)) return true;
  const formPath = page => page.pathname.replace(/\/(?:viewform|formResponse)\/?$/, '').replace(/^\/forms\/u\/\d+\//,'/forms/');
  return isGoogleForms(a) && isGoogleForms(b) && formPath(first) === formPath(second);
}

export function isLegacyGoogleCapture(step) {
  return isGoogleForms(step.url) && step.fields.length > 0 &&
    step.fields.every(field => !field.key.startsWith('google-forms:'));
}

// Serialized into the browser tab. Keep all DOM helpers inside this function.
export async function googleFormsSignup({step, answers} = {}) {
  const page = new URL(location.href);
  const form = [...document.forms].find(node => /\/formResponse$/.test(new URL(node.action).pathname));
  const visible = node => node.getClientRects().length > 0 &&
    getComputedStyle(node).visibility === 'visible' && !node.closest('[aria-hidden="true"],[hidden]');
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const warnings = form ? [] : ['Unfamiliar control: open the Google Forms responder page first.'];
  const questions = [];
  const controls = form ? [...form.querySelectorAll('[data-params]')].filter(visible) : [];
  const consent = /\b(?:consent|waiver|terms and conditions|terms of (?:use|service)|privacy policy|I (?:agree|authorize|certify|acknowledge|accept))\b/i;

  function addQuestion(key, label, help, required, type, optionNodes, control) {
    const choices = new Map();
    const role = control?.getAttribute('role');
    for (const node of optionNodes) {
      const value = node.getAttribute('data-value') ?? node.getAttribute('data-answer-value') ??
        node.getAttribute('aria-label') ?? text(node);
      if (!value && role === 'listbox') continue; // "Choose" placeholder.
      if (!value || value === '__other_option__' || choices.has(value)) {
        warnings.push('Unfamiliar control: custom or duplicate choice in ' + label);
        continue;
      }
      choices.set(value, node);
    }
    const options = [...choices.keys()].sort().map(value => ({value, label:value}));
    questions.push({field:{
      key, label, help, required, type, options, visible:true,
      maxLength:control?.maxLength > 0 ? control.maxLength : null,
      pattern:control?.pattern || '',
      min:control?.min || '', max:control?.max || '',
    }, control, choices});
  }

  for (const question of controls) {
    const id = question.getAttribute('data-params').match(/^%\.@\.\[(-?\d+),/)?.[1];
    if (!id) continue;
    const card = question.closest('[role=listitem]') || question;
    const heading = card.querySelector('[role=heading]');
    const label = text(heading).replace(/\s*\*$/, '');
    const help = text(card.querySelector('.gBAuic'));
    const required = !!heading && /\*\s*$/.test(text(heading)) ||
      !!question.querySelector('[aria-required="true"],[required]');
    const native = [...question.querySelectorAll('input:not([type=hidden]),textarea')].filter(visible);
    const radios = [...question.querySelectorAll('[role=radio]')].filter(visible);
    const checks = [...question.querySelectorAll('[role=checkbox]')].filter(visible);
    const listbox = [...question.querySelectorAll('[role=listbox]')].filter(visible);
    const key = 'google-forms:' + id;
    if (!label || consent.test(label + ' ' + help) ||
        question.querySelectorAll('[role=radiogroup]').length > 1 ||
        checks.some(node => node.hasAttribute('data-field-id')) ||
        question.querySelector('[role=table],[role=grid],table')) {
      warnings.push('Unfamiliar control: complete ' + (label || 'this question') + ' on Google Forms.');
    } else if (listbox.length === 1 && !radios.length && !checks.length && !native.length) {
      addQuestion(key,label,help,required,'select',listbox[0].querySelectorAll('[role=option]'),listbox[0]);
    } else if (radios.length && !checks.length && !listbox.length) {
      addQuestion(key,label,help,required,'radio',radios);
    } else if (checks.length && !radios.length && !listbox.length) {
      addQuestion(key,label,help,required,'checkbox',checks);
    } else if (native.length === 1 && ['text','email','tel','url','number','date','textarea'].includes(native[0].type)) {
      addQuestion(key,label,help,required,native[0].type,[],native[0]);
    } else {
      warnings.push('Unfamiliar control: complete ' + label + ' on Google Forms.');
    }
  }

  // Google puts its built-in email collection outside the ordinary question cards.
  const email = form?.querySelector('input[name=emailAddress]');
  if (email && visible(email) && !controls.some(question => question.contains(email))) {
    addQuestion('google-forms:email','Email','',email.required || email.getAttribute('aria-required') === 'true','email',[],email);
  }
  const unmapped = [...(form?.querySelectorAll('input:not([type=hidden]),textarea,select,[role=radio],[role=checkbox],[role=listbox]') || [])]
    .some(node => node !== email && visible(node) && !controls.some(question => question.contains(node)));
  if (unmapped) warnings.push('Unfamiliar control: this form contains an unrecognized answer field.');

  if (!step) {
    // Next can reload a section at /formResponse. Drafts always start at /viewform.
    page.pathname = page.pathname.replace(/\/(?:viewform|formResponse)\/?$/, '/viewform');
    page.search = '';
    page.hash = '';
    const fields = questions.map(question => question.field);
    if (fields.length > 100) warnings.push('Unfamiliar control: this section exceeds the 100-question capture limit.');
    return {
      url:page.href, title:document.title, formIndex:0, formChoices:[],
      fields:fields.slice(0,100), stepToken:fields.map(field => field.key).sort().join(',').slice(0,300),
      terms:'', warnings, capturedAt:new Date().toISOString(),
    };
  }

  const report = [];
  async function waitFor(predicate, ms = 1200) {
    const until = Date.now() + ms;
    while (!predicate() && Date.now() < until) await new Promise(resolve => setTimeout(resolve,25));
    return predicate();
  }
  for (const field of step.fields) {
    const matches = questions.filter(question => question.field.key === field.key);
    let restored = false;
    if (matches.length === 1) {
      const {control,choices} = matches[0];
      const value = answers[field.key] || '';
      if (field.type === 'radio' || field.type === 'checkbox') {
        let selected = value ? [value] : [];
        if (field.type === 'checkbox' && value) {
          try { selected = JSON.parse(value); } catch { selected = null; }
        }
        const checked = node => node.getAttribute('aria-checked') === 'true';
        if (Array.isArray(selected) && (!field.required || selected.length) && selected.every(option => choices.has(option))) {
          for (const [option,node] of choices) {
            const wanted = selected.includes(option);
            if ((wanted || field.type === 'checkbox') && checked(node) !== wanted) {
              if (!await waitFor(() => node.getAttribute('aria-disabled') !== 'true')) break;
              node.click();
              if (!await waitFor(() => checked(node) === wanted)) break;
            }
          }
          restored = [...choices].every(([option,node]) => checked(node) === selected.includes(option));
        }
      } else if (field.type === 'select') {
        const selected = () => [...choices].find(([,node]) => node.getAttribute('aria-selected') === 'true')?.[0] || '';
        if (value && choices.has(value) && selected() !== value) {
          const option = () => [...control.querySelectorAll('[role=option]')]
            .find(node => visible(node) && node.getBoundingClientRect().height > 0 && node.getAttribute('data-value') === value);
          if (!option()) (control.querySelector('[jsname=LgbsSe]') || control).click();
          if (await waitFor(option)) {
            // Wait for Google's expanded menu to finish binding its option handlers.
            await new Promise(resolve => setTimeout(resolve,350));
            const item = option();
            if (item) {
              (item.querySelector('span') || item).click();
              await waitFor(() => selected() === value);
            }
          }
        }
        restored = selected() === value && (!field.required || !!value);
      } else if (!control.disabled && !control.readOnly) {
        const prototype = control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,'value').set.call(control,value);
        control.dispatchEvent(new Event('input',{bubbles:true}));
        control.dispatchEvent(new Event('change',{bubbles:true}));
        restored = control.value === value && (!field.required || !!value.trim());
      }
    }
    report.push(field.label + (restored ? ': restored.' : ': ambiguous or missing; fill manually.'));
  }
  return report;
}
