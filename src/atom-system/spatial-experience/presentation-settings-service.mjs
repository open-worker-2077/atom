const own = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function problem(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function validatePatch(patch, fields) {
  if (!own(patch) || !Object.keys(patch).length) {
    throw problem('INVALID_PRESENTATION_SETTINGS', 'Settings patch must be a nonempty object');
  }
  for (const [key, value] of Object.entries(patch)) {
    const valid = fields.has(key) && (key === 'helpVisible' ? typeof value === 'boolean'
      : key === 'defaultDetailMode' ? ['name', 'surface', 'floating'].includes(value)
        : key === 'idleSeconds' && value === null ? true
          : typeof value === 'number' && Number.isFinite(value));
    if (!valid) throw problem('INVALID_PRESENTATION_SETTINGS', `Invalid settings field: ${key}`);
  }
}

export function createPresentationSettingsService({ repository, normalizeSettings }) {
  const fields = new Set(Object.keys(normalizeSettings({})));
  async function read() {
    let document;
    try { document = await repository.read(); }
    catch (error) {
      if (error.code === 'ENOENT') return { revision: 0, initialized: false, settings: null };
      throw error;
    }
    const settings = document.view?.presentationSettings;
    if (document.revision < 1 || !own(document.view) || Object.keys(document.view).length !== 1
      || !own(settings) || Object.keys(settings).length !== fields.size) {
      throw problem('INVALID_PRESENTATION_SETTINGS_DOCUMENT', 'Expected a saved presentation settings document');
    }
    validatePatch(settings, fields);
    return { revision: document.revision, initialized: true, settings: normalizeSettings(settings) };
  }

  async function update(input) {
    if (!own(input) || Object.keys(input).some(key => !['expectedRevision', 'patch', 'bootstrap'].includes(key))
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || (Object.hasOwn(input, 'bootstrap') && typeof input.bootstrap !== 'boolean')) {
      throw problem('INVALID_PRESENTATION_SETTINGS', 'Expected revision, patch and optional bootstrap boolean');
    }
    validatePatch(input.patch, fields);
    const { expectedRevision, bootstrap } = input;
    const patch = { ...input.patch };
    const current = await read();
    if (current.revision !== expectedRevision || (current.initialized && bootstrap)) {
      throw problem('PRESENTATION_SETTINGS_CONFLICT', 'Presentation settings changed; read the latest settings', 409);
    }
    if (!current.initialized && bootstrap !== true) {
      throw problem('PRESENTATION_SETTINGS_BOOTSTRAP_REQUIRED', 'The existing local configuration must initialize shared settings');
    }
    const settings = normalizeSettings({ ...current.settings, ...patch });
    try {
      const document = await repository.write({ presentationSettings: settings }, { expectedRevision });
      return { revision: document.revision, initialized: true, settings: document.view.presentationSettings };
    } catch (error) {
      if (error.code === 'VIEW_STATE_CONFLICT') {
        throw problem('PRESENTATION_SETTINGS_CONFLICT', 'Presentation settings changed; read the latest settings', 409);
      }
      throw error;
    }
  }

  return Object.freeze({ read, update });
}
