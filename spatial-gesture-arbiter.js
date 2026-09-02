(function exposeSpatialGestureArbiter(root) {
  'use strict';

  const dragOnlyIntents = new Set(['orbit', 'grab', 'release']);
  const fieldTapIntents = new Set([
    'clearFocus',
    'toggleFieldChildren',
    'toggleFieldSurfaces',
    'applyParentView'
  ]);

  function immutableAction(intent, visualMeta, target) {
    const safeVisualMeta = visualMeta && typeof visualMeta === 'object' && !Array.isArray(visualMeta)
      ? Object.freeze({ ...visualMeta })
      : Object.freeze({});
    return Object.freeze({
      intent,
      visualMeta: safeVisualMeta,
      target: target || null
    });
  }

  function classifyTap(candidate) {
    if (!candidate || typeof candidate !== 'object' || candidate.cancelled === true) {
      return null;
    }

    if (candidate.direct !== undefined && candidate.direct !== null) {
      const direct = candidate.direct;
      if (!direct || typeof direct !== 'object' || typeof direct.intent !== 'string' || !direct.intent) {
        return null;
      }
      return immutableAction(direct.intent, direct.visualMeta, direct.target);
    }

    if (typeof candidate.intent !== 'string' || !candidate.intent || dragOnlyIntents.has(candidate.intent)) {
      return null;
    }
    if (candidate.node) {
      return immutableAction(candidate.intent, candidate.visualMeta, candidate.node);
    }
    if (fieldTapIntents.has(candidate.intent)) {
      return immutableAction(candidate.intent, candidate.visualMeta, null);
    }
    return null;
  }

  function createPrimaryClickArbiter(options = {}) {
    const delay = Number.isFinite(options.delay) ? options.delay : 280;
    const setTimer = options.setTimer || root.setTimeout.bind(root);
    const clearTimer = options.clearTimer || root.clearTimeout.bind(root);
    const commit = typeof options.commit === 'function' ? options.commit : function noop() {};
    const observe = typeof options.observe === 'function' ? options.observe : function noop() {};
    let pendingTimer = null;
    let pendingToken = null;
    let pendingActions = null;
    let pendingSignature = null;
    let pendingCount = 0;
    let tripleCommitted = false;

    function resetPending() {
      pendingTimer = null;
      pendingToken = null;
      pendingActions = null;
      pendingSignature = null;
      pendingCount = 0;
      tripleCommitted = false;
    }

    function actionForCount() {
      if (!pendingActions) return null;
      if (pendingCount === 1) return pendingActions.single || null;
      if (pendingCount === 2) return pendingActions.double || null;
      return tripleCommitted ? null : pendingActions.triple || null;
    }

    function settlePending() {
      const action = actionForCount();
      resetPending();
      if (action) commit(action);
    }

    function schedule() {
      const token = {};
      pendingToken = token;
      pendingTimer = setTimer(() => {
        if (pendingToken !== token) return;
        settlePending();
      }, delay);
    }

    function cancel() {
      if (pendingTimer !== null) {
        clearTimer(pendingTimer);
      }
      resetPending();
    }

    function defer(action) {
      cancel();
      pendingActions = { single: action, double: null, triple: null };
      pendingSignature = 'defer';
      pendingCount = 1;
      schedule();
    }

    function submit(singleAction, doubleAction, tripleAction, signature) {
      const safeSignature = typeof signature === 'string' && signature ? signature : 'field';
      if (pendingToken !== null && pendingSignature !== safeSignature) {
        if (pendingTimer !== null) clearTimer(pendingTimer);
        settlePending();
      }

      if (pendingToken === null) {
        pendingActions = {
          single: singleAction || null,
          double: doubleAction || null,
          triple: tripleAction || null
        };
        pendingSignature = safeSignature;
        pendingCount = 1;
        observe(Object.freeze({
          signature: safeSignature,
          count: pendingCount,
          target: singleAction?.target ?? doubleAction?.target ?? tripleAction?.target ?? null
        }));
        schedule();
        return 'pending:1';
      }

      if (pendingTimer !== null) clearTimer(pendingTimer);
      pendingActions = {
        single: singleAction || pendingActions.single || null,
        double: doubleAction || pendingActions.double || null,
        triple: tripleAction || pendingActions.triple || null
      };
      pendingCount += 1;
      observe(Object.freeze({
        signature: safeSignature,
        count: pendingCount,
        target: singleAction?.target ?? doubleAction?.target ?? tripleAction?.target ?? null
      }));
      if (pendingCount === 3) {
        const action = pendingActions.triple;
        tripleCommitted = true;
        if (action) commit(action);
        schedule();
        return 'triple';
      }
      schedule();
      return `pending:${pendingCount}`;
    }

    return Object.freeze({
      defer,
      submit,
      cancel,
      get pending() {
        return pendingToken !== null;
      },
      get pendingCount() {
        return pendingCount;
      }
    });
  }

  function createSecondaryClickArbiter(options = {}) {
    const delay = Number.isFinite(options.delay) ? options.delay : 240;
    const setTimer = options.setTimer || root.setTimeout.bind(root);
    const clearTimer = options.clearTimer || root.clearTimeout.bind(root);
    const commitSingle = typeof options.commitSingle === 'function' ? options.commitSingle : function noop() {};
    const commitDouble = typeof options.commitDouble === 'function' ? options.commitDouble : function noop() {};
    let pendingTimer = null;
    let pendingToken = null;
    let pendingAction = null;
    let pendingSignature = null;

    function resetPending() {
      pendingTimer = null;
      pendingToken = null;
      pendingAction = null;
      pendingSignature = null;
    }

    function cancel() {
      if (pendingTimer !== null) {
        clearTimer(pendingTimer);
      }
      resetPending();
    }

    function submit(singleAction, doubleAction, signature) {
      const safeSignature = typeof signature === 'string' && signature ? signature : 'field';
      if (pendingToken !== null && pendingSignature === safeSignature) {
        if (pendingTimer !== null) clearTimer(pendingTimer);
        resetPending();
        commitDouble(doubleAction);
        return 'double';
      }

      if (pendingToken !== null) {
        const previousAction = pendingAction;
        if (pendingTimer !== null) clearTimer(pendingTimer);
        resetPending();
        commitSingle(previousAction);
      }

      const token = {};
      pendingToken = token;
      pendingAction = singleAction;
      pendingSignature = safeSignature;
      pendingTimer = setTimer(() => {
        if (pendingToken !== token) return;
        const action = pendingAction;
        resetPending();
        commitSingle(action);
      }, delay);
      return 'pending';
    }

    return Object.freeze({
      submit,
      cancel,
      get pending() {
        return pendingToken !== null;
      }
    });
  }

  const api = Object.freeze({
    classifyTap,
    createPrimaryClickArbiter,
    createSecondaryClickArbiter
  });

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpatialGestureArbiter = api;
})(typeof window !== 'undefined' ? window : globalThis);
