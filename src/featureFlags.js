// Central feature flags
// Toggle multi-tenancy features. Set REACT_APP_MULTI_TENANCY=true in a .env file to enable.
export const MULTI_TENANCY_ENABLED = (process.env.REACT_APP_MULTI_TENANCY || 'false') === 'true';
