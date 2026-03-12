/**
 * Standard API response types
 */

export interface ApiResponse<T> {
  data?: T;
  message?: string;
  success?: boolean;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
