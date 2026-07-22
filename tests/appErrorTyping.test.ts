import { AppError } from '../server/domain/errors/app-error.js';

// This file is compiled directly to ensure provider details remain valid error messages.
void new AppError('model_unavailable', 'DeepSeek returned status 503');
