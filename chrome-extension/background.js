
// bind it to window so it can be accessed from the popup screen
window.cdinjector = new CDInjector(chrome, typeof document !== "undefined" ? document : undefined);
