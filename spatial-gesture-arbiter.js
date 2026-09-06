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
    const delayFor = typeof options.delayFor === 'function'
      ? options.delayFor
      : () => (Number.isFinite(options.delay) ? options.delay : 420);
    const setTimer = options.setTimer || root.setTimeout.bind(root);
    const clearTimer = options.clearTimer || root.clearTimeout.bind(root);
    const defaultNow = root.performance && typeof root.performance.now === 'function'
      ? root.performance.now.bind(root.performance)
      : () => 0;
    const now = typeof options.now === 'function' ? options.now : defaultNow;
    const commitSingle = typeof options.commitSingle === 'function' ? options.commitSingle : function noop() {};
    const commitHold = typeof options.commitHold === 'function' ? options.commitHold : function noop() {};
    let pendingTimer = null;
    let pendingToken = null;
    let pendingSingleAction = null;
    let pendingHoldAction = null;
    let pendingSignature = null;
    let pendingSequenceSignature = null;
    let pendingPhysicalPoint = null;
    let pendingDelay = 420;
    let pendingStartedAt = 0;
    let holdCommitted = false;
    let recentSingle = null;

    function resetPending() {
      pendingTimer = null;
      pendingToken = null;
      pendingSingleAction = null;
      pendingHoldAction = null;
      pendingSignature = null;
      pendingSequenceSignature = null;
      pendingPhysicalPoint = null;
      pendingDelay = 420;
      pendingStartedAt = 0;
      holdCommitted = false;
    }

    function cancel() {
      if (pendingTimer !== null) {
        clearTimer(pendingTimer);
      }
      resetPending();
    }

    function schedule(token, delay) {
      pendingTimer = setTimer(() => {
        if (pendingToken !== token) return;
        pendingTimer = null;
        holdCommitted = true;
        commitHold(pendingHoldAction);
      }, delay);
    }

    function begin(singleAction, holdAction, signature, sequenceSignature, physicalPoint) {
      cancel();
      if (!singleAction || typeof singleAction !== 'object') return 'idle';
      const safeSignature = typeof signature === 'string' && signature ? signature : 'field';
      const safeSequenceSignature = typeof sequenceSignature === 'string' && sequenceSignature
        ? sequenceSignature
        : safeSignature;
      const token = {};
      pendingToken = token;
      pendingSingleAction = singleAction;
      pendingHoldAction = holdAction || null;
      pendingSignature = safeSignature;
      pendingSequenceSignature = safeSequenceSignature;
      const pointX = Number(physicalPoint && physicalPoint.x);
      const pointY = Number(physicalPoint && physicalPoint.y);
      const pointTolerance = Number(physicalPoint && physicalPoint.tolerance);
      pendingPhysicalPoint = (
        Number.isFinite(pointX)
        && Number.isFinite(pointY)
        && Number.isFinite(pointTolerance)
        && pointTolerance > 0
      ) ? { x: pointX, y: pointY, tolerance: pointTolerance } : null;
      pendingDelay = Math.min(800, Math.max(240, Number(delayFor()) || 420));
      pendingStartedAt = Number(now());
      if (!Number.isFinite(pendingStartedAt)) pendingStartedAt = 0;
      if (pendingHoldAction) schedule(token, pendingDelay);
      return 'pending';
    }

    function release(signature) {
      if (pendingToken === null) return 'idle';
      const safeSignature = typeof signature === 'string' && signature ? signature : 'field';
      if (safeSignature !== pendingSignature) {
        cancel();
        return 'cancelled';
      }
      if (pendingTimer !== null) clearTimer(pendingTimer);
      const singleAction = pendingSingleAction;
      const completedHold = holdCommitted;
      const releaseSignature = pendingSignature;
      const releaseSequenceSignature = pendingSequenceSignature;
      const releasePhysicalPoint = pendingPhysicalPoint;
      const releaseDelay = pendingDelay;
      const startedAt = pendingStartedAt;
      const holdAction = pendingHoldAction;
      const releasedAt = Number(now());
      const elapsedHold = Boolean(holdAction)
        && Number.isFinite(releasedAt)
        && releasedAt - startedAt >= releaseDelay;
      resetPending();
      if (completedHold) return 'hold';
      if (elapsedHold) {
        commitHold(holdAction);
        return 'hold';
      }
      const safeReleasedAt = Number.isFinite(releasedAt) ? releasedAt : 0;
      const sameSequence = recentSingle && recentSingle.signature === releaseSequenceSignature;
      const continuesBlankSequence = Boolean(
        recentSingle
        && releasePhysicalPoint
        && recentSingle.physicalPoint
        && Math.hypot(
          releasePhysicalPoint.x - recentSingle.physicalPoint.x,
          releasePhysicalPoint.y - recentSingle.physicalPoint.y
        ) < recentSingle.physicalPoint.tolerance
        && (
          recentSingle.exactSignature.startsWith('field')
          || releaseSignature.startsWith('field')
        )
      );
      if (recentSingle && (sameSequence || continuesBlankSequence) && safeReleasedAt - recentSingle.at <= recentSingle.delay) {
        recentSingle = null;
        return 'coalesced';
      }
      recentSingle = {
        signature: releaseSequenceSignature,
        exactSignature: releaseSignature,
        physicalPoint: releasePhysicalPoint,
        at: safeReleasedAt,
        delay: releaseDelay
      };
      commitSingle(singleAction);
      return 'single';
    }

    return Object.freeze({
      begin,
      release,
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
