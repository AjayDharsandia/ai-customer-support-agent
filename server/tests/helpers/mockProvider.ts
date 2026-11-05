import MockAdapter from 'axios-mock-adapter';
import type { AxiosInstance } from 'axios';

export function mockProvider(client: AxiosInstance) {
  // axios-mock-adapter declares the CommonJS Axios type; NodeNext uses Axios's
  // separate ESM declaration. Both represent the same Axios runtime instance.
  return new MockAdapter(client as unknown as ConstructorParameters<typeof MockAdapter>[0], { onNoMatch: 'throwException' });
}
