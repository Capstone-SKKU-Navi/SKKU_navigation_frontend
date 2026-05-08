/**
 * Constructs the mobile DOM scaffold under <body>.
 *
 * Each mobile feature adds its own content to the right container element.
 * PC chrome (`#appHeader`, `#floorWheel`, `#roomPopup`, `#roomInfoPopup`,
 * `#layerPanel`) stays in the DOM but is hidden via `body[data-device="mobile"]`
 * rules in SCSS.
 */

export const MOBILE_IDS = {
  searchPill: 'mSearchPill',
  searchModal: 'mSearchModal',
  floorWheel: 'mFloorWheel',
  chipRow: 'mChipRow',
  radial: 'mRadial',
  popup: 'mPopup',
  sheet: 'mSheet',
  sheetHandle: 'mSheetHandle',
  sheetContent: 'mSheetContent',
  actions: 'mActions',
  actCenter: 'mActCenter',
  act3D: 'mAct3D',
  actClear: 'mActClear',
  toast: 'mToast',
} as const;

export function buildMobileChrome(): void {
  // Root container — one div that owns all mobile-only elements so the
  // scaffold can be torn down in one line if we ever need to.
  const root = document.createElement('div');
  root.id = 'mobileRoot';
  root.setAttribute('data-mobile-root', '');

  root.appendChild(buildSearchPill());
  root.appendChild(buildActionStack());
  root.appendChild(buildFloorWheel());
  root.appendChild(buildChipRow());
  root.appendChild(buildRoomPopup());
  root.appendChild(buildRadial());
  root.appendChild(buildSearchModal());
  root.appendChild(buildSheet());
  root.appendChild(buildToast());

  document.body.appendChild(root);
}

function buildToast(): HTMLElement {
  const toast = document.createElement('div');
  toast.id = MOBILE_IDS.toast;
  toast.className = 'm-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('data-visible', 'false');
  toast.innerHTML = `
    <span class="material-icons m-toast-icon">error_outline</span>
    <span class="m-toast-text"></span>
  `;
  return toast;
}

function buildSearchPill(): HTMLElement {
  const pill = document.createElement('button');
  pill.id = MOBILE_IDS.searchPill;
  pill.className = 'm-search-pill';
  pill.setAttribute('aria-label', '방 검색');
  pill.innerHTML = `
    <span class="material-icons">search</span>
    <span class="m-search-pill-text">방 검색</span>
  `;
  return pill;
}

function buildSearchModal(): HTMLElement {
  const modal = document.createElement('div');
  modal.id = MOBILE_IDS.searchModal;
  modal.className = 'm-search-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `
    <div class="m-search-modal-header">
      <button class="m-search-back" aria-label="닫기">
        <span class="material-icons">arrow_back</span>
      </button>
      <input type="text" class="m-search-input" placeholder="방 검색 (예: 21517)" autocomplete="off" />
      <button class="m-search-clear" aria-label="지우기" hidden>
        <span class="material-icons">close</span>
      </button>
    </div>
    <ul class="m-search-results"></ul>
  `;
  return modal;
}

function buildFloorWheel(): HTMLElement {
  const wheel = document.createElement('div');
  wheel.id = MOBILE_IDS.floorWheel;
  wheel.className = 'm-floor-wheel';
  wheel.innerHTML = `<div class="m-floor-wheel-inner"></div>`;
  return wheel;
}

function buildChipRow(): HTMLElement {
  const row = document.createElement('div');
  row.id = MOBILE_IDS.chipRow;
  row.className = 'm-chip-row';
  row.setAttribute('aria-hidden', 'true');
  return row;
}

function buildRoomPopup(): HTMLElement {
  const popup = document.createElement('div');
  popup.id = MOBILE_IDS.popup;
  popup.className = 'm-popup';
  popup.setAttribute('aria-hidden', 'true');
  return popup;
}

function buildRadial(): HTMLElement {
  const radial = document.createElement('div');
  radial.id = MOBILE_IDS.radial;
  radial.className = 'm-radial';
  radial.setAttribute('aria-hidden', 'true');
  return radial;
}

/** Right-side vertical cluster of floating action buttons. */
function buildActionStack(): HTMLElement {
  const stack = document.createElement('div');
  stack.id = MOBILE_IDS.actions;
  stack.className = 'm-actions';
  stack.innerHTML = `
    <button id="${MOBILE_IDS.actCenter}" class="m-act" aria-label="건물 위치로 이동">
      <span class="material-icons">center_focus_weak</span>
    </button>
    <button id="${MOBILE_IDS.act3D}" class="m-act" aria-label="2D/3D 전환">
      <span class="material-icons">3d_rotation</span>
    </button>
    <button id="${MOBILE_IDS.actClear}" class="m-act m-act-danger" aria-label="경로 지우기" data-visible="false">
      <span class="material-icons">close</span>
    </button>
  `;
  return stack;
}

function buildSheet(): HTMLElement {
  const sheet = document.createElement('div');
  sheet.id = MOBILE_IDS.sheet;
  sheet.className = 'm-sheet';
  sheet.setAttribute('data-state', 'hidden');
  sheet.innerHTML = `
    <div id="${MOBILE_IDS.sheetHandle}" class="m-sheet-handle" role="button" aria-label="시트 드래그"><div class="m-sheet-grip"></div></div>
    <div id="${MOBILE_IDS.sheetContent}" class="m-sheet-content"></div>
  `;
  return sheet;
}
