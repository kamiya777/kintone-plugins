(function () {
  'use strict';

  // Safety net: if anything throws (even before the table finishes loading),
  // surface it on the page instead of leaving "読み込み中..." forever with a
  // silent console-only error.
  window.addEventListener('error', function (e) { reportFatalError(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { reportFatalError(e.reason); });

  function reportFatalError(err) {
    var msg = escapeHtml((err && err.message) ? err.message : String(err));
    var tableBody = document.getElementById('sfm-table-body');
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="9" class="sfm-empty-row">エラーが発生しました: ' + msg + '</td></tr>';
    } else {
      var banner = document.createElement('div');
      banner.style.cssText = 'background:#c0392b;color:#fff;padding:10px 14px;margin-bottom:10px;border-radius:4px;';
      banner.textContent = 'エラーが発生しました: ' + msg;
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }

  var appId = kintone.app.getId();

  var FIELD_TYPE_LABELS = {
    SINGLE_LINE_TEXT: '文字列（1行）',
    MULTI_LINE_TEXT: '文字列（複数行）',
    RICH_TEXT: 'リッチエディター',
    NUMBER: '数値',
    CALC: '計算',
    RADIO_BUTTON: 'ラジオボタン',
    CHECK_BOX: 'チェックボックス',
    MULTI_SELECT: '複数選択',
    DROP_DOWN: 'ドロップダウン',
    USER_SELECT: 'ユーザー選択',
    ORGANIZATION_SELECT: '組織選択',
    GROUP_SELECT: 'グループ選択',
    DATE: '日付',
    TIME: '時刻',
    DATETIME: '日時',
    LINK: 'リンク',
    FILE: '添付ファイル',
    SUBTABLE: 'テーブル',
    REFERENCE_TABLE: '関連レコード一覧',
    GROUP: 'グループ',
    RECORD_NUMBER: 'レコード番号',
    CREATOR: '作成者',
    CREATED_TIME: '作成日時',
    MODIFIER: '更新者',
    UPDATED_TIME: '更新日時',
    STATUS_ASSIGNEE: '作業者'
  };

  // required/unique/noLabel: which toggle columns apply to each field type
  // (per kintone's field property reference; containers and system fields get none)
  var FIELD_CAPABILITIES = {
    SINGLE_LINE_TEXT: { required: true, unique: true, noLabel: true },
    MULTI_LINE_TEXT: { required: true, unique: false, noLabel: true },
    RICH_TEXT: { required: true, unique: false, noLabel: true },
    NUMBER: { required: true, unique: true, noLabel: true },
    CALC: { required: false, unique: false, noLabel: true },
    RADIO_BUTTON: { required: true, unique: false, noLabel: true },
    CHECK_BOX: { required: true, unique: false, noLabel: true },
    MULTI_SELECT: { required: true, unique: false, noLabel: true },
    DROP_DOWN: { required: true, unique: false, noLabel: true },
    USER_SELECT: { required: true, unique: false, noLabel: true },
    ORGANIZATION_SELECT: { required: true, unique: false, noLabel: true },
    GROUP_SELECT: { required: true, unique: false, noLabel: true },
    DATE: { required: true, unique: false, noLabel: true },
    TIME: { required: true, unique: false, noLabel: true },
    DATETIME: { required: true, unique: false, noLabel: true },
    LINK: { required: true, unique: true, noLabel: true },
    FILE: { required: true, unique: false, noLabel: true },
    SUBTABLE: { required: false, unique: false, noLabel: false },
    GROUP: { required: false, unique: false, noLabel: false },
    REFERENCE_TABLE: { required: false, unique: false, noLabel: false },
    RECORD_NUMBER: { required: false, unique: false, noLabel: false },
    CREATOR: { required: false, unique: false, noLabel: false },
    CREATED_TIME: { required: false, unique: false, noLabel: false },
    MODIFIER: { required: false, unique: false, noLabel: false },
    UPDATED_TIME: { required: false, unique: false, noLabel: false },
    STATUS_ASSIGNEE: { required: false, unique: false, noLabel: false }
  };

  var TYPE_SORT_ORDER = Object.keys(FIELD_CAPABILITIES);

  // Field types that aren't manageable here (process management / decorative layout elements)
  var EXCLUDED_TYPES = ['CATEGORY', 'STATUS', 'LABEL', 'SPACER', 'HR'];

  // Fields that always exist on the app (standard system fields) or are only present
  // when process management is enabled (作業者). Either way they're only part of the
  // form layout if someone has explicitly placed them on the form, so they need to be
  // pulled in from the field properties directly.
  var SYSTEM_FIELD_TYPES = ['RECORD_NUMBER', 'CREATOR', 'CREATED_TIME', 'MODIFIER', 'UPDATED_TIME', 'STATUS_ASSIGNEE'];

  var PROHIBITED_CODES = ['ステータス', '作業者', 'カテゴリー'];
  var CODE_CHAR_PATTERN = /^[A-Za-z0-9_ぁ-んァ-ヶー一-龠々＄￥$¥€£]+$/;
  var EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

  var els = {};
  var state = {
    fields: [],
    rawProperties: null,
    sortOrder: 'form',
    typeFilter: '',
    selected: new Set()
  };

  // The plugin config page can inject this script after the DOM has already
  // finished parsing, in which case DOMContentLoaded has already fired and
  // would never come again - so run immediately in that case instead of
  // waiting forever.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    cacheElements();
    bindEvents();
    loadFields();
  }

  function cacheElements() {
    els.sortOrder = document.getElementById('sfm-sort-order');
    els.typeFilter = document.getElementById('sfm-type-filter');
    els.fieldCount = document.getElementById('sfm-field-count');
    els.copySelectedBtn = document.getElementById('sfm-copy-selected-btn');
    els.selectedCount = document.getElementById('sfm-selected-count');
    els.selectAll = document.getElementById('sfm-select-all');
    els.tableBody = document.getElementById('sfm-table-body');
    els.helpBtn = document.getElementById('sfm-help-btn');
    els.cancelBtn = document.getElementById('sfm-cancel-btn');
    els.saveBtn = document.getElementById('sfm-save-btn');

    els.detailModal = document.getElementById('sfm-detail-modal');
    els.detailTitle = document.getElementById('sfm-detail-title');
    els.detailBody = document.getElementById('sfm-detail-body');

    els.confirmModal = document.getElementById('sfm-confirm-modal');
    els.confirmMessage = document.getElementById('sfm-confirm-message');
    els.confirmOkBtn = document.getElementById('sfm-confirm-ok-btn');
    els.confirmCancelBtn = document.getElementById('sfm-confirm-cancel-btn');

    els.helpModal = document.getElementById('sfm-help-modal');
    els.loadingOverlay = document.getElementById('sfm-loading-overlay');
    els.loadingText = document.getElementById('sfm-loading-text');
    els.toast = document.getElementById('sfm-toast');
  }

  function bindEvents() {
    els.sortOrder.addEventListener('change', function () {
      state.sortOrder = els.sortOrder.value;
      render();
    });
    els.typeFilter.addEventListener('change', function () {
      state.typeFilter = els.typeFilter.value;
      render();
    });
    els.selectAll.addEventListener('change', function () {
      var visible = getVisibleRows();
      visible.forEach(function (row) {
        if (els.selectAll.checked) state.selected.add(row.id);
        else state.selected.delete(row.id);
      });
      render();
    });
    els.copySelectedBtn.addEventListener('click', onCopySelected);
    els.saveBtn.addEventListener('click', onSave);
    els.cancelBtn.addEventListener('click', onCancel);
    els.helpBtn.addEventListener('click', function () { showModal(els.helpModal); });

    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        hideModal(document.getElementById(btn.getAttribute('data-close')));
      });
    });
    [els.detailModal, els.helpModal].forEach(function (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) hideModal(overlay);
      });
    });
  }

  // ---- Data loading -------------------------------------------------

  function loadFields() {
    try {
      Promise.all([
        kintone.api(kintone.api.url('/k/v1/preview/app/form/fields.json', true), 'GET', { app: appId }),
        kintone.api(kintone.api.url('/k/v1/preview/app/form/layout.json', true), 'GET', { app: appId })
      ]).then(function (results) {
        var fieldsResp = results[0];
        var layoutResp = results[1];
        state.rawProperties = fieldsResp.properties;
        state.fields = buildRows(fieldsResp.properties, layoutResp.layout);
        populateTypeFilterOptions();
        render();
      }).catch(handleLoadError);
    } catch (err) {
      handleLoadError(err);
    }
  }

  function handleLoadError(err) {
    var msg = errorMessage(err, 'フィールド情報の取得に失敗しました。');
    els.tableBody.innerHTML = '<tr><td colspan="9" class="sfm-empty-row">フィールド情報の取得に失敗しました: ' + escapeHtml(msg) + '</td></tr>';
    showToast(msg, 'error');
  }

  function buildRows(properties, layout) {
    var rows = [];
    var order = 0;

    function pushRow(schema, tableCode, placement) {
      if (!schema || EXCLUDED_TYPES.indexOf(schema.type) !== -1) return;
      rows.push({
        id: order++,
        code: schema.code,
        tableCode: tableCode || null,
        type: schema.type,
        label: schema.label || '',
        required: !!schema.required,
        unique: !!schema.unique,
        noLabel: !!schema.noLabel,
        placement: placement,
        isLookup: !!schema.lookup,
        codeError: null,
        properties: schema
      });
    }

    function walk(items, placement) {
      (items || []).forEach(function (item) {
        if (item.type === 'ROW') {
          (item.fields || []).forEach(function (f) {
            if (!f.code) return;
            pushRow(properties[f.code], null, placement);
          });
        } else if (item.type === 'SUBTABLE') {
          var tableSchema = properties[item.code];
          pushRow(tableSchema, null, placement);
          (item.fields || []).forEach(function (f) {
            if (!f.code || !tableSchema || !tableSchema.fields) return;
            pushRow(tableSchema.fields[f.code], item.code, 'テーブル内');
          });
        } else if (item.type === 'GROUP') {
          pushRow(properties[item.code], null, placement);
          walk(item.layout, 'グループ内');
        }
      });
    }

    walk(layout, '通常');

    var placedCodes = {};
    rows.forEach(function (r) { if (!r.tableCode) placedCodes[r.code] = true; });
    Object.keys(properties).forEach(function (code) {
      var schema = properties[code];
      if (SYSTEM_FIELD_TYPES.indexOf(schema.type) !== -1 && !placedCodes[code]) {
        pushRow(schema, null, '未配置(システム)');
      }
    });

    return rows;
  }

  function populateTypeFilterOptions() {
    var present = {};
    state.fields.forEach(function (r) { present[r.type] = true; });
    var types = TYPE_SORT_ORDER.filter(function (t) { return present[t]; });
    els.typeFilter.innerHTML = '<option value="">すべて</option>' + types.map(function (t) {
      return '<option value="' + t + '">' + (FIELD_TYPE_LABELS[t] || t) + '</option>';
    }).join('');
  }

  // ---- Rendering ------------------------------------------------------

  function getVisibleRows() {
    var rows = state.fields.slice();
    if (state.typeFilter) rows = rows.filter(function (r) { return r.type === state.typeFilter; });
    if (state.sortOrder === 'type') {
      rows.sort(function (a, b) {
        var ai = TYPE_SORT_ORDER.indexOf(a.type);
        var bi = TYPE_SORT_ORDER.indexOf(b.type);
        return ai !== bi ? ai - bi : a.id - b.id;
      });
    } else {
      rows.sort(function (a, b) { return a.id - b.id; });
    }
    return rows;
  }

  function render() {
    var rows = getVisibleRows();
    els.fieldCount.textContent = state.typeFilter
      ? 'フィールド数: ' + state.fields.length + '(表示中: ' + rows.length + ')'
      : 'フィールド数: ' + state.fields.length;

    els.tableBody.innerHTML = '';
    if (!rows.length) {
      els.tableBody.innerHTML = '<tr><td colspan="9" class="sfm-empty-row">該当するフィールドがありません。</td></tr>';
    } else {
      rows.forEach(function (row) { els.tableBody.appendChild(createRowElement(row)); });
    }
    updateSelectionUi(rows);
  }

  function createRowElement(row) {
    var tr = document.createElement('tr');
    if (state.selected.has(row.id)) tr.classList.add('sfm-row-selected');

    var tdCheck = document.createElement('td');
    tdCheck.className = 'sfm-col-check';
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(row.id);
    checkbox.addEventListener('change', function () {
      if (checkbox.checked) state.selected.add(row.id);
      else state.selected.delete(row.id);
      tr.classList.toggle('sfm-row-selected', checkbox.checked);
      updateSelectionUi(getVisibleRows());
    });
    tdCheck.appendChild(checkbox);
    tr.appendChild(tdCheck);

    var tdType = document.createElement('td');
    tdType.className = 'sfm-field-type-badge';
    tdType.textContent = (FIELD_TYPE_LABELS[row.type] || row.type) + (row.isLookup ? '(ルックアップ)' : '');
    tr.appendChild(tdType);

    var tdPlacement = document.createElement('td');
    tdPlacement.className = 'sfm-placement';
    tdPlacement.textContent = row.placement;
    tr.appendChild(tdPlacement);

    var tdName = document.createElement('td');
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'sfm-text-input';
    nameInput.maxLength = 128;
    nameInput.value = row.label;
    nameInput.addEventListener('input', function () { row.label = nameInput.value; });
    tdName.appendChild(nameInput);
    tr.appendChild(tdName);

    var tdCode = document.createElement('td');
    var codeWrap = document.createElement('div');
    codeWrap.className = 'sfm-code-cell';
    var copyOneBtn = document.createElement('button');
    copyOneBtn.type = 'button';
    copyOneBtn.className = 'sfm-copy-one-btn';
    copyOneBtn.title = 'フィールド名をフィールドコードへコピー';
    copyOneBtn.textContent = '→';
    copyOneBtn.addEventListener('click', function () { onCopyOne(row); });
    var codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.className = 'sfm-text-input' + (row.codeError ? ' sfm-input-error' : '');
    codeInput.maxLength = 128;
    codeInput.value = row.code;
    codeInput.addEventListener('input', function () {
      row.code = codeInput.value;
      row.codeError = null;
      codeInput.classList.remove('sfm-input-error');
      var errMsg = tdCode.querySelector('.sfm-input-error-msg');
      if (errMsg) errMsg.remove();
    });
    codeWrap.appendChild(copyOneBtn);
    codeWrap.appendChild(codeInput);
    tdCode.appendChild(codeWrap);
    if (row.codeError) {
      var errEl = document.createElement('div');
      errEl.className = 'sfm-input-error-msg';
      errEl.textContent = row.codeError;
      tdCode.appendChild(errEl);
    }
    tr.appendChild(tdCode);

    tr.appendChild(createToggleCell(row, 'required'));
    tr.appendChild(createToggleCell(row, 'unique'));
    tr.appendChild(createToggleCell(row, 'noLabel'));

    var tdDetail = document.createElement('td');
    tdDetail.className = 'sfm-col-detail';
    var detailBtn = document.createElement('button');
    detailBtn.type = 'button';
    detailBtn.className = 'sfm-detail-btn';
    detailBtn.textContent = '詳細';
    detailBtn.addEventListener('click', function () { openDetail(row); });
    tdDetail.appendChild(detailBtn);
    tr.appendChild(tdDetail);

    return tr;
  }

  function createToggleCell(row, key) {
    var td = document.createElement('td');
    td.className = 'sfm-col-toggle';
    var capability = FIELD_CAPABILITIES[row.type];
    if (!capability || !capability[key]) {
      var na = document.createElement('span');
      na.className = 'sfm-toggle-na';
      na.textContent = '-';
      td.appendChild(na);
      return td;
    }
    var label = document.createElement('label');
    label.className = 'sfm-toggle';
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!row[key];
    input.addEventListener('change', function () { row[key] = input.checked; });
    var slider = document.createElement('span');
    slider.className = 'sfm-toggle-slider';
    label.appendChild(input);
    label.appendChild(slider);
    td.appendChild(label);
    return td;
  }

  function updateSelectionUi(visibleRows) {
    visibleRows = visibleRows || getVisibleRows();
    els.selectedCount.textContent = state.selected.size + '件選択中';
    els.copySelectedBtn.disabled = state.selected.size === 0;
    els.selectAll.checked = visibleRows.length > 0 && visibleRows.every(function (r) { return state.selected.has(r.id); });
  }

  // ---- Field code copy ------------------------------------------------

  function sanitizeToCode(name) {
    if (!name || EMOJI_PATTERN.test(name)) return null;
    var code = name.replace(/[^A-Za-z0-9ぁ-んァ-ヶー一-龠々＄￥$¥€£]/g, '');
    if (/^[0-9]/.test(code)) code = '_' + code;
    if (!code) return null;
    return code.slice(0, 128);
  }

  function onCopyOne(row) {
    var newCode = sanitizeToCode(row.label);
    if (newCode === null) {
      showToast('フィールド名に絵文字が含まれているため、コピーできません。', 'error');
      return;
    }
    var duplicate = state.fields.some(function (r) { return r !== row && r.code === newCode; });
    if (duplicate) {
      showToast('コピー先のフィールドコードが他のフィールドと重複しています。', 'error');
      return;
    }
    row.code = newCode;
    row.codeError = null;
    render();
  }

  function onCopySelected() {
    if (!state.selected.size) return;
    showConfirm('選択した ' + state.selected.size + ' 件のフィールド名を、フィールドコードへコピーしますか?', performCopySelected);
  }

  function performCopySelected() {
    var existingCodes = {};
    state.fields.forEach(function (r) { existingCodes[r.code] = true; });

    var applied = 0, skippedEmoji = 0, skippedDup = 0;
    state.fields.forEach(function (row) {
      if (!state.selected.has(row.id)) return;
      var newCode = sanitizeToCode(row.label);
      if (newCode === null) { skippedEmoji++; return; }
      if (newCode !== row.code && existingCodes[newCode]) { skippedDup++; return; }
      delete existingCodes[row.code];
      row.code = newCode;
      row.codeError = null;
      existingCodes[newCode] = true;
      applied++;
    });

    render();
    var message = applied + ' 件のフィールドコードをコピーしました。';
    if (skippedEmoji) message += ' 絵文字を含むため ' + skippedEmoji + ' 件スキップしました。';
    if (skippedDup) message += ' コード重複のため ' + skippedDup + ' 件スキップしました。';
    showToast(message, (skippedEmoji || skippedDup) ? 'error' : 'success');
  }

  // ---- Validation & save ----------------------------------------------

  function validateAll() {
    var codeCount = {};
    state.fields.forEach(function (row) { codeCount[row.code] = (codeCount[row.code] || 0) + 1; });

    var invalid = [];
    state.fields.forEach(function (row) {
      var error = null;
      var code = (row.code || '').trim();
      if (!row.label || !row.label.trim()) {
        error = 'フィールド名を入力してください。';
      } else if (!code) {
        error = 'フィールドコードを入力してください。';
      } else if (code.length > 128) {
        error = 'フィールドコードは128文字以内で入力してください。';
      } else if (EMOJI_PATTERN.test(code)) {
        error = '絵文字は使用できません。';
      } else if (/^[0-9]/.test(code)) {
        error = 'フィールドコードの先頭に数字は使用できません。';
      } else if (!CODE_CHAR_PATTERN.test(code)) {
        error = '使用できない文字が含まれています。';
      } else if (PROHIBITED_CODES.indexOf(code) !== -1 && row.type !== 'STATUS_ASSIGNEE') {
        error = 'このフィールドコードは使用できません。';
      } else if (codeCount[row.code] > 1) {
        error = 'フィールドコードが重複しています。';
      }
      row.codeError = error;
      if (error) invalid.push(row);
    });
    return invalid;
  }

  function collectChanges() {
    return state.fields.filter(function (row) {
      var orig = row.properties;
      return row.label !== (orig.label || '') ||
        row.code !== orig.code ||
        row.required !== !!orig.required ||
        row.unique !== !!orig.unique ||
        row.noLabel !== !!orig.noLabel;
    });
  }

  function applyOverrides(clone, row) {
    clone.label = row.label;
    clone.code = row.code;
    var capability = FIELD_CAPABILITIES[row.type];
    if (capability && capability.required) clone.required = row.required;
    if (capability && capability.unique) clone.unique = row.unique;
    if (capability && capability.noLabel) clone.noLabel = row.noLabel;
  }

  function buildPayloadProperties(changedRows) {
    var payload = {};
    var touchedTables = {};

    changedRows.forEach(function (row) {
      if (row.tableCode) {
        touchedTables[row.tableCode] = true;
      } else {
        var clone = JSON.parse(JSON.stringify(row.properties));
        applyOverrides(clone, row);
        payload[row.properties.code] = clone;
      }
    });

    Object.keys(touchedTables).forEach(function (tableCode) {
      var tableClone = JSON.parse(JSON.stringify(state.rawProperties[tableCode]));
      var tableRow = changedRows.find(function (r) { return !r.tableCode && r.properties.code === tableCode; });
      if (tableRow) applyOverrides(tableClone, tableRow);
      changedRows
        .filter(function (r) { return r.tableCode === tableCode; })
        .forEach(function (innerRow) {
          var innerClone = tableClone.fields[innerRow.properties.code];
          applyOverrides(innerClone, innerRow);
        });
      payload[tableCode] = tableClone;
    });

    return payload;
  }

  function onSave() {
    var invalid = validateAll();
    render();
    if (invalid.length) {
      showToast('入力内容に誤りがあります。赤枠の項目を確認してください。', 'error');
      return;
    }
    var changed = collectChanges();
    if (!changed.length) {
      showToast('変更点がありません。');
      return;
    }
    showConfirm('保存すると、この内容がアプリのフィールド設定に反映されます。よろしいですか?', function () {
      performSave(changed);
    });
  }

  function performSave(changedRows) {
    showLoading('保存中...');
    var payload = buildPayloadProperties(changedRows);

    kintone.api(kintone.api.url('/k/v1/preview/app/form/fields.json', true), 'PUT', { app: appId, properties: payload })
      .then(function () {
        setLoadingText('アプリを更新中...');
        return kintone.api(kintone.api.url('/k/v1/preview/app/deploy.json', true), 'POST', { apps: [{ app: appId }] });
      })
      .then(pollDeploy)
      .then(function () {
        hideLoading();
        showToast('保存が完了しました。', 'success');
        kintone.plugin.app.setConfig({ setupDone: 'true' }, function () {
          setTimeout(function () {
            window.location.href = '/k/admin/app/flow?app=' + appId;
          }, 800);
        });
      })
      .catch(function (err) {
        hideLoading();
        showToast(errorMessage(err, '保存に失敗しました。'), 'error');
      });
  }

  function pollDeploy() {
    var attempts = 0;
    return new Promise(function (resolve, reject) {
      (function check() {
        kintone.api(kintone.api.url('/k/v1/preview/app/deploy.json', true), 'GET', { apps: [appId] })
          .then(function (resp) {
            var status = resp.apps && resp.apps[0] && resp.apps[0].status;
            if (status === 'SUCCESS') return resolve();
            if (status === 'FAIL' || status === 'CANCELLED') return reject(new Error('アプリの更新に失敗しました。'));
            attempts++;
            if (attempts > 30) return reject(new Error('アプリの更新がタイムアウトしました。時間をおいて再度お試しください。'));
            setTimeout(check, 1000);
          })
          .catch(reject);
      })();
    });
  }

  function onCancel() {
    var changed = collectChanges();
    if (!changed.length) { history.back(); return; }
    showConfirm('編集中の内容は破棄されます。よろしいですか?', function () { history.back(); });
  }

  // ---- Detail dialog ---------------------------------------------------

  function openDetail(row) {
    var props = row.properties;
    els.detailTitle.textContent = (row.label || props.code) + '(' + (FIELD_TYPE_LABELS[row.type] || row.type) + ')';

    var lines = [];
    lines.push(['フィールドコード', props.code]);
    lines.push(['フィールドタイプ', FIELD_TYPE_LABELS[row.type] || row.type]);
    lines.push(['配置', row.placement]);
    if (row.tableCode) lines.push(['所属テーブル', row.tableCode]);
    if (typeof props.required === 'boolean' && FIELD_CAPABILITIES[row.type] && FIELD_CAPABILITIES[row.type].required) {
      lines.push(['必須項目にする', props.required ? 'ON' : 'OFF']);
    }
    if (FIELD_CAPABILITIES[row.type] && FIELD_CAPABILITIES[row.type].unique) {
      lines.push(['値の重複を禁止する', props.unique ? 'ON' : 'OFF']);
    }
    if (FIELD_CAPABILITIES[row.type] && FIELD_CAPABILITIES[row.type].noLabel) {
      lines.push(['フィールド名を表示しない', props.noLabel ? 'ON' : 'OFF']);
    }
    if (props.defaultValue !== undefined && props.defaultValue !== '' &&
      !(Array.isArray(props.defaultValue) && props.defaultValue.length === 0)) {
      lines.push(['初期値', formatDisplayValue(props.defaultValue)]);
    }
    if (props.options) {
      var optionLabels = Object.keys(props.options)
        .sort(function (a, b) { return props.options[a].index - props.options[b].index; })
        .map(function (k) { return props.options[k].label; });
      lines.push(['選択肢', optionLabels.join('、')]);
    }
    if (props.expression) lines.push(['計算式', props.expression]);
    if (props.format) lines.push(['表示形式', props.format]);
    if (props.unit) lines.push(['単位', props.unit]);
    if (props.protocol) lines.push(['プロトコル', props.protocol]);
    if (props.lookup) {
      lines.push(['ルックアップ', 'コピー元アプリID: ' + (props.lookup.relatedApp && props.lookup.relatedApp.app) +
        ' / 参照フィールド: ' + props.lookup.relatedKeyField]);
    }
    if (props.referenceTable) {
      lines.push(['参照設定', 'アプリID: ' + (props.referenceTable.relatedApp && props.referenceTable.relatedApp.app)]);
    }
    if (props.fields) lines.push(['テーブル内フィールド数', Object.keys(props.fields).length + ' 個']);

    els.detailBody.innerHTML = '<table class="sfm-detail-table">' + lines.map(function (line) {
      return '<tr><th>' + escapeHtml(line[0]) + '</th><td>' + escapeHtml(String(line[1])) + '</td></tr>';
    }).join('') + '</table>';

    showModal(els.detailModal);
  }

  function formatDisplayValue(value) {
    return Array.isArray(value) ? value.join('、') : value;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Modal / toast / loading helpers ----------------------------------

  function showModal(modalEl) { modalEl.classList.remove('sfm-hidden'); }
  function hideModal(modalEl) { modalEl.classList.add('sfm-hidden'); }

  function showConfirm(message, onOk) {
    els.confirmMessage.textContent = message;
    showModal(els.confirmModal);

    function cleanup() {
      els.confirmOkBtn.removeEventListener('click', okHandler);
      els.confirmCancelBtn.removeEventListener('click', cancelHandler);
      hideModal(els.confirmModal);
    }
    function okHandler() { cleanup(); onOk(); }
    function cancelHandler() { cleanup(); }

    els.confirmOkBtn.addEventListener('click', okHandler);
    els.confirmCancelBtn.addEventListener('click', cancelHandler);
  }

  var toastTimer = null;
  function showToast(message, type) {
    els.toast.textContent = message;
    els.toast.className = 'sfm-toast' + (type === 'error' ? ' sfm-toast-error' : type === 'success' ? ' sfm-toast-success' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.add('sfm-hidden'); }, 3800);
  }

  function showLoading(text) {
    els.loadingText.textContent = text;
    els.loadingOverlay.classList.remove('sfm-hidden');
  }
  function setLoadingText(text) { els.loadingText.textContent = text; }
  function hideLoading() { els.loadingOverlay.classList.add('sfm-hidden'); }

  function errorMessage(err, fallback) {
    if (err && err.message) return err.message;
    return fallback;
  }
})();
