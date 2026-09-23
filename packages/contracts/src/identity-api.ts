const str = { type: 'string' } as const;
const id = { type: 'string', format: 'uuid' } as const;
const account = {
  type: 'object',
  required: ['id', 'name', 'administrator', 'enabled'],
  properties: { id, name: str, administrator: { type: 'boolean' }, enabled: { type: 'boolean' } },
};
const grant = {
  type: 'object',
  required: ['repository', 'access'],
  properties: { repository: str, access: { type: 'string', enum: ['read', 'write'] } },
};
const group = {
  type: 'object',
  required: ['id', 'name', 'members', 'grants'],
  properties: {
    id,
    name: str,
    members: { type: 'array', items: id },
    grants: { type: 'array', items: grant },
  },
};
const body = (schema: unknown) => ({ required: true, content: { 'application/json': { schema } } });
const response = (schema: unknown) => ({
  description: 'Success',
  content: { 'application/json': { schema } },
});
const error = { description: 'Error with code, message and requestId' };
const path = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: name === 'repository' ? str : id,
});
export const identityPaths = {
  '/api/v1/auth/login': {
    post: {
      security: [],
      summary: 'Exchange account credentials for a 12-hour bearer session',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        required: ['name', 'password'],
        properties: { name: str, password: { type: 'string', format: 'password' } },
      }),
      responses: {
        200: response({
          type: 'object',
          required: ['token', 'expiresAt', 'account'],
          properties: { token: str, expiresAt: { type: 'string', format: 'date-time' }, account },
        }),
        default: error,
      },
    },
  },
  '/api/v1/auth/logout': {
    post: {
      summary: 'Revoke current account session',
      responses: { 204: { description: 'Revoked' }, default: error },
    },
  },
  '/api/v1/auth/password': {
    post: {
      summary: 'Change own password; requires an account session and revokes all sessions',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', format: 'password' },
          newPassword: { type: 'string', format: 'password' },
        },
      }),
      responses: { 204: { description: 'Password changed; sign in again' }, default: error },
    },
  },
  '/api/v1/auth/me': {
    get: {
      summary: 'Current principal and repository grants',
      responses: {
        200: response({
          type: 'object',
          properties: {
            id: str,
            administrator: { type: 'boolean' },
            grants: {
              type: 'array',
              items: {
                type: 'object',
                properties: { repository: str, permissions: { type: 'array', items: str } },
              },
            },
          },
        }),
        default: error,
      },
    },
  },
  '/api/v1/users': {
    get: {
      summary: 'List accounts; administrator only',
      responses: {
        200: response({ type: 'object', properties: { items: { type: 'array', items: account } } }),
        default: error,
      },
    },
    post: {
      summary: 'Create account; administrator only',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        required: ['name', 'password'],
        properties: {
          name: str,
          password: { type: 'string', format: 'password' },
          administrator: { type: 'boolean' },
        },
      }),
      responses: { 201: response(account), default: error },
    },
  },
  '/api/v1/users/{id}': {
    parameters: [path('id')],
    patch: {
      summary:
        'Enable, disable or reset an account password; administrator only; revokes sessions when disabled or reset',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          password: { type: 'string', format: 'password' },
        },
      }),
      responses: { 200: response(account), default: error },
    },
  },
  '/api/v1/access-groups': {
    get: {
      summary: 'List groups, members and grants; administrator only',
      responses: {
        200: response({ type: 'object', properties: { items: { type: 'array', items: group } } }),
        default: error,
      },
    },
    post: {
      summary: 'Create access group; administrator only',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: { name: str },
      }),
      responses: { 201: response(group), default: error },
    },
  },
  '/api/v1/access-groups/{id}/members/{userId}': {
    parameters: [path('id'), path('userId')],
    put: {
      summary: 'Add account to group; administrator only',
      responses: { 204: { description: 'Member added' }, default: error },
    },
    delete: {
      summary: 'Remove account from group; administrator only',
      responses: { 204: { description: 'Member removed' }, default: error },
    },
  },
  '/api/v1/access-groups/{id}/grants/{repository}': {
    parameters: [path('id'), path('repository')],
    put: {
      summary: 'Set repository group access; administrator only',
      requestBody: body({
        type: 'object',
        additionalProperties: false,
        required: ['access'],
        properties: { access: { type: 'string', enum: ['read', 'write'] } },
      }),
      responses: { 204: { description: 'Grant set' }, default: error },
    },
    delete: {
      summary: 'Remove repository group access; administrator only',
      responses: { 204: { description: 'Grant removed' }, default: error },
    },
  },
};
