import React, { createContext, useContext } from 'react';

// Provides tenantId for multi-tenancy. Defaults to 'default' for legacy docs.
const TenantContext = createContext({ tenantId: 'default', setTenantId: () => {} });

export const TenantProvider = ({ tenantId, setTenantId, children }) => (
  <TenantContext.Provider value={{ tenantId, setTenantId }}>
    {children}
  </TenantContext.Provider>
);

export const useTenant = () => useContext(TenantContext);
