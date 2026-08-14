function worldServiceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createWorldService(options = {}) {
  const hasLegacy = typeof options.executeLegacyInteraction === 'function';
  const commandExecutor = options.commandPipeline?.execute ?? options.commitCoordinator?.execute;
  const hasCommand = typeof commandExecutor === 'function';
  const hasRollback = typeof options.commitCoordinator?.rollback === 'function';
  const hasProjectionRecovery = typeof options.commandPipeline?.recoverProjection === 'function';
  const hasTransactions = hasCommand || hasRollback;
  if (!hasLegacy && !hasTransactions) {
    throw worldServiceError(
      'WORLD_SERVICE_CAPABILITY_REQUIRED',
      'World Service requires a legacy executor or commit coordinator'
    );
  }

  return Object.freeze({
    executeLegacy(request) {
      if (!hasLegacy) {
        throw worldServiceError('WORLD_CAPABILITY_UNAVAILABLE', 'Legacy interaction is not configured');
      }
      if (!request || typeof request !== 'object' || Array.isArray(request)
        || typeof request.source !== 'string' || !request.source.trim()) {
        throw worldServiceError(
          'INVALID_WORLD_INTERACTION_SOURCE',
          'Legacy world interaction requires a non-empty source'
        );
      }
      return options.executeLegacyInteraction(request);
    },
    command(request) {
      if (!hasCommand) {
        throw worldServiceError('WORLD_CAPABILITY_UNAVAILABLE', 'Transactional commands are not configured');
      }
      return commandExecutor.call(options.commandPipeline ?? options.commitCoordinator, request);
    },
    rollback(request) {
      if (!hasRollback) {
        throw worldServiceError('WORLD_CAPABILITY_UNAVAILABLE', 'Transactional rollback is not configured');
      }
      return options.commitCoordinator.rollback(request);
    },
    recoverProjection(request) {
      if (!hasProjectionRecovery) {
        throw worldServiceError('WORLD_CAPABILITY_UNAVAILABLE', 'Projection recovery is not configured');
      }
      return options.commandPipeline.recoverProjection(request);
    }
  });
}
