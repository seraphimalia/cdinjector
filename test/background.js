
const
    vm = require("vm"),
    fs = require("fs"),
    assert = require("assert"),
    {describe, it} = require("mocha"),
    chrome = require("sinon-chrome");

describe("Background script", function () {

    it ("should bind CDInjector instance to window", function () {
        // Thanks this SO answer for showing how to do this: https://stackoverflow.com/a/26779746/778272
        const cdinjectorCode = fs.readFileSync(__dirname + "/../chrome-extension/cdinjector.js");
        const backgroundCode = fs.readFileSync(__dirname + "/../chrome-extension/background.js");
        const context = {
            window: {},
            chrome: chrome,
        };

        vm.runInNewContext([cdinjectorCode, backgroundCode].join("\n\n"), context);

        // should be listening for messages from the tab context
        assert(chrome.runtime.onMessage.addListener.calledOnce);
        // should be listening for tab switches
        assert(chrome.tabs.onActivated.addListener.calledOnce);

        assert.notStrictEqual(typeof context.window.cdinjector, "undefined");
        assert.strictEqual(context.window.cdinjector.constructor.name, "CDInjector");
    });
});
