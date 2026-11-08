import {
  analysisTargetNameSchema,
  analysisTargetSourceUrlSchema,
  createAnalysisTargetSchema,
} from '@reviewlens/shared';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { LoadingState } from '../../../components/ui/LoadingState';
import { ApiError } from '../../../lib/api-client';
import { useApi } from '../../../lib/api-context';
import { FALLBACK_MESSAGE } from '../../../lib/errors';
import {
  ANALYSIS_TARGETS_CHANGED_EVENT,
  createAnalysisTarget,
  type CreatedAnalysisTarget,
} from '../api';

type FieldName = 'name' | 'sourceUrl';
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELD_SCHEMAS = {
  name: analysisTargetNameSchema,
  sourceUrl: analysisTargetSourceUrlSchema,
};

export function CreateTargetPage() {
  const client = useApi();
  const [name, setName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdTarget, setCreatedTarget] = useState<CreatedAnalysisTarget | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = createAnalysisTargetSchema.safeParse({ name, sourceUrl }).success;

  function updateField(field: FieldName, value: string) {
    if (field === 'name') setName(value);
    else setSourceUrl(value);

    const result = FIELD_SCHEMAS[field].safeParse(value);
    setFieldErrors((current) => ({
      ...current,
      [field]: result.success ? undefined : result.error.issues[0]?.message,
    }));
    setErrorMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createAnalysisTargetSchema.safeParse({ name, sourceUrl });
    if (!parsed.success) {
      setFieldErrors({
        name: parsed.error.issues.find((issue) => issue.path[0] === 'name')?.message,
        sourceUrl: parsed.error.issues.find((issue) => issue.path[0] === 'sourceUrl')?.message,
      });
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const target = await createAnalysisTarget(client, parsed.data);
      setCreatedTarget(target);
      window.dispatchEvent(new Event(ANALYSIS_TARGETS_CHANGED_EVENT));
      setName('');
      setSourceUrl('');
      setFieldErrors({});
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : FALLBACK_MESSAGE);
      if (error instanceof ApiError) {
        setFieldErrors({
          name: firstFieldError(error, 'name') ?? undefined,
          sourceUrl: firstFieldError(error, 'sourceUrl') ?? undefined,
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleChange(field: FieldName) {
    return (event: ChangeEvent<HTMLInputElement>) => updateField(field, event.target.value);
  }

  return (
    <section className="target-create-page">
      <header className="page-heading">
        <p className="eyebrow">GET STARTED</p>
        <h1>Create an analysis target</h1>
        <p>
          Add a place to ReviewLens. We’ll save it to your account so you can work with it later.
        </p>
      </header>

      {createdTarget && (
        <div className="target-success" role="status">
          <span className="success-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <h2>Target created</h2>
            <p>
              <strong>{createdTarget.name}</strong> is saved to your account. You can create another
              target or open its saved source.
            </p>
            <a href={createdTarget.sourceUrl} rel="noopener noreferrer" target="_blank">
              Open source in Google Maps
            </a>
          </div>
          <button type="button" className="button" onClick={() => setCreatedTarget(null)}>
            Create another
          </button>
        </div>
      )}

      {errorMessage && (
        <p className="form-error-summary" role="alert">
          {errorMessage}
        </p>
      )}

      <form className="target-form" onSubmit={handleSubmit} noValidate>
        <div className="form-intro">
          <h2>Target details</h2>
          <p>Give your target a name and a link to the Google Maps place you want to analyze.</p>
        </div>

        <div className="form-field">
          <label htmlFor="target-name">
            Target name <span aria-hidden="true">*</span>
          </label>
          <input
            autoComplete="organization"
            className="form-input"
            id="target-name"
            maxLength={200}
            name="name"
            onChange={handleChange('name')}
            value={name}
            aria-describedby={fieldErrors.name ? 'target-name-error' : 'target-name-hint'}
            aria-invalid={Boolean(fieldErrors.name)}
            required
          />
          {fieldErrors.name ? (
            <p className="field-error" id="target-name-error">
              {fieldErrors.name}
            </p>
          ) : (
            <p className="field-hint" id="target-name-hint">
              Choose a name you’ll recognize later.
            </p>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="target-source-url">
            Google Maps place URL <span aria-hidden="true">*</span>
          </label>
          <input
            autoComplete="url"
            className="form-input"
            id="target-source-url"
            inputMode="url"
            name="sourceUrl"
            onChange={handleChange('sourceUrl')}
            placeholder="https://www.google.com/maps/place/..."
            type="url"
            value={sourceUrl}
            aria-describedby={
              fieldErrors.sourceUrl ? 'target-source-url-error' : 'target-source-url-hint'
            }
            aria-invalid={Boolean(fieldErrors.sourceUrl)}
            required
          />
          {fieldErrors.sourceUrl ? (
            <p className="field-error" id="target-source-url-error">
              {fieldErrors.sourceUrl}
            </p>
          ) : (
            <p className="field-hint" id="target-source-url-hint">
              Use a Google Maps place link or a share link that opens a specific place.
            </p>
          )}
        </div>

        <div className="form-field platform-field">
          <span className="form-label">Review platform</span>
          <div className="platform-choice">
            <span className="maps-pin" aria-hidden="true">
              ⌖
            </span>
            <span>
              <strong>Google Maps</strong>
              <small>Review platform supported by ReviewLens</small>
            </span>
            <span className="platform-badge">SUPPORTED</span>
          </div>
        </div>

        {isSubmitting && <LoadingState label="Saving your target…" />}

        <div className="form-actions">
          <button
            className="button button-primary"
            disabled={!isValid || isSubmitting}
            type="submit"
          >
            {isSubmitting ? 'Creating target…' : 'Create Target'}
          </button>
          <p>Your target is private to your account.</p>
        </div>
      </form>
    </section>
  );
}

function firstFieldError(error: ApiError, field: FieldName): string | null {
  const fieldErrors = error.details?.fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== 'object' || Array.isArray(fieldErrors)) return null;
  const messages = Reflect.get(fieldErrors, field);
  return Array.isArray(messages) && typeof messages[0] === 'string' ? messages[0] : null;
}
