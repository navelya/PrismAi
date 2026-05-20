import type { ValidationError } from './validate-execution';

export function formatValidationError(e: ValidationError): string {
    switch (e.kind) {
        case 'missing-required-input':
            return `Input '${e.inputLabel}' is required`;
        case 'no-upstream-data':
            return `Input '${e.inputLabel}' needs ${e.sourceNodeLabel} to run first`;
        case 'type-mismatch':
            return `Input '${e.inputLabel}' expects ${e.expectedType}, got ${e.actualType}`;
    }
}
