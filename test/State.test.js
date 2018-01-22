import State from '../src/State';

describe('State', () => {
  describe('constants', () => {
    it('should have all defined states', () => {
      expect(State.SYNC_CONNECTED).toBeDefined();
      expect(State.DISCONNECTED).toBeDefined();
      expect(State.AUTH_FAILED).toBeDefined();
      expect(State.CONNECTED_READ_ONLY).toBeDefined();
      expect(State.SASL_AUTHENTICATED).toBeDefined();
      expect(State.EXPIRED).toBeDefined();
    });
  });

  it('gets the sate name', () => {
    expect(State.DISCONNECTED.getName()).toEqual('DISCONNECTED');
  });

  it('gets the sate code', () => {
    expect(State.DISCONNECTED.getCode()).toEqual(0);
  });

  it('represents the state as a string', () => {
    const state = State.DISCONNECTED;
    const expectedString = `${state.getName()}[${state.getCode()}]`;

    expect(String(State.DISCONNECTED)).toEqual(expectedString);
  });
});
