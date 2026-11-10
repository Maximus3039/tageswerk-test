function query() {
 const promise = Promise.resolve({data: [], error: null, count: 0});
 const chain = {
  select() { return chain; },
  eq() { return chain; },
  is() { return chain; },
  in() { return chain; },
  order() { return chain; },
  limit() { return chain; },
  then(onFulfilled, onRejected) { return promise.then(onFulfilled, onRejected); }
 };
 return chain;
}

export function createClient() {
 return {
  from: query,
  rpc() {
   return Promise.resolve({data: null, error: {message: 'Tests rufen keine Datenbankfunktion auf.'}});
  },
  auth: {
   getUser: async () => ({data: {user: null}, error: null}),
   getSession: async () => ({data: {session: null}, error: null}),
   signInWithPassword: async () => ({data: null, error: {message: 'Keine Anmeldung im Test.'}}),
   signOut: async () => ({error: null}),
   updateUser: async () => ({data: null, error: null}),
   onAuthStateChange() {
    return {data: {subscription: {unsubscribe() {}}}};
   }
  },
  channel() {
   return {on() { return this; }, subscribe() {}};
  },
  removeChannel() {}
 };
}
