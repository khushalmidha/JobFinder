export function createFormNotice(onFill, onReview) {
  const host = document.createElement('div');
  host.dataset.jobfinderUi = '';
  const root = host.attachShadow({ mode: 'open' });
  const style = new CSSStyleSheet();
  style.replaceSync(`
    :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      width: min(320px, calc(100vw - 32px)); color: #fff; font: 14px system-ui, sans-serif; }
    section { position: relative; padding: 15px 40px 15px 15px; border-radius: 12px;
      border: 1px solid #3f3f46; background: #18181b; box-shadow: 0 6px 24px #0005; }
    p { margin: 5px 0 10px; color: #e4e4e7; line-height: 1.4; }
    button { cursor: pointer; font: inherit; }
    .action { border: 0; border-radius: 6px; padding: 6px 10px; background: #facc15; color: #18181b; font-weight: 650; }
    .close { position: absolute; top: 8px; right: 8px; border: 0; background: transparent; color: white; font-size: 19px; }
    button:focus-visible { outline: 2px solid white; outline-offset: 3px; }
  `);
  root.adoptedStyleSheets = [style];
  const card = document.createElement('section');
  card.setAttribute('aria-label', 'JobFinder Smart Apply');
  const title = document.createElement('strong');
  title.textContent = 'Smart Apply';
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const action = document.createElement('button');
  action.className = 'action';
  action.type = 'button';
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss Smart Apply');
  close.textContent = '×';
  close.onclick = () => host.remove();
  card.append(title, message, action, close);
  root.append(card);
  return {
    show(text, nextAction, { fresh = false } = {}) {
      message.textContent = text;
      action.hidden = !nextAction;
      action.textContent = nextAction === 'review' ? 'Go to first field' : 'Fill this form';
      action.onclick = nextAction === 'review' ? onReview : onFill;
      if (fresh && !host.isConnected) document.body.append(host);
    }
  };
}
