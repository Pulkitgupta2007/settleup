/**
 * SettleUp - Typed Error Hierarchy & Response Formatter
 * 
 * Provides domain-specific error classes with clear HTTP status codes,
 * error codes, and structured metadata for frontend consumption.
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = []) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

class NotFoundError extends AppError {
  constructor(resource, identifier) {
    super(`${resource} with identifier "${identifier}" was not found`, 404, 'NOT_FOUND', {
      resource,
      identifier,
    });
  }
}

class ConflictError extends AppError {
  constructor(message, details = null) {
    super(message, 409, 'CONFLICT', details);
  }
}

class ConstraintDeadlockError extends AppError {
  constructor(message, details = {}) {
    super(
      message || 'Settlement cannot proceed due to mutual payment avoidance constraints',
      422,
      'CONSTRAINT_DEADLOCK',
      details
    );
  }
}

class TransactionError extends AppError {
  constructor(message, originalError = null) {
    super(
      message || 'Database transaction failed and was rolled back to protect ledger integrity',
      500,
      'TRANSACTION_ABORTED',
      {
        rollbackConfirmed: true,
        originalMessage: originalError?.message || null,
      }
    );
  }
}

class CurrencyConversionError extends AppError {
  constructor(message, details = {}) {
    super(message || 'Currency conversion failed', 502, 'FX_CONVERSION_FAILED', details);
  }
}

/**
 * Transforms any Error (AppError, Mongoose ValidationError, CastError, MongoServerError)
 * into a standardized JSON API response with appropriate HTTP status code.
 * 
 * @param {Error} err
 * @returns {{ statusCode: number, body: { success: false, error: Object } }}
 */
function formatErrorResponse(err) {
  // 1. Handled domain error
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  // 2. Mongoose CastError (invalid ObjectId format)
  if (err.name === 'CastError') {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: {
          code: 'INVALID_IDENTIFIER',
          message: `Invalid format for field "${err.path}": expected a valid 24-character hexadecimal ID`,
          details: { path: err.path, value: err.value },
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  // 3. Mongoose Schema ValidationError
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map(e => ({
      field: e.path,
      message: e.message,
    }));
    return {
      statusCode: 400,
      body: {
        success: false,
        error: {
          code: 'SCHEMA_VALIDATION_ERROR',
          message: 'Request payload failed schema validation constraints',
          details,
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  // 4. Algorithm constraint deadlock from Phase 1
  if (err.message && err.message.includes('Cannot satisfy constraints')) {
    return {
      statusCode: 422,
      body: {
        success: false,
        error: {
          code: 'CONSTRAINT_DEADLOCK',
          message: err.message,
          details: {
            suggestion: 'Add an intermediary member to the group or relax direct payment restrictions.',
          },
          timestamp: new Date().toISOString(),
        },
      },
    };
  }

  // 5. Unhandled / unexpected system error
  return {
    statusCode: 500,
    body: {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal error occurred. All database changes were aborted.',
        timestamp: new Date().toISOString(),
      },
    },
  };
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ConstraintDeadlockError,
  TransactionError,
  CurrencyConversionError,
  formatErrorResponse,
};
