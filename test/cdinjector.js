
const
    assert = require("assert"),
    {describe, it, setup, teardown} = require("mocha"),
    sinon = require("sinon"),
    chrome = require("sinon-chrome"),
    CDInjector = require("../chrome-extension/cdinjector");

describe("CDInjector", function () {

    const tabId = 42;
    const sampleCode = "// some javascript code";

    /** @type {CDInjector} */
    let cdinjector;
    let sender;

    setup(function () {
        cdinjector = new CDInjector(chrome, undefined);
        sinon.stub(cdinjector, "queryLocalServerForFile").resolves(sampleCode);

        sender = {
            tab: { id: tabId },
            frameId: 0
        };
    });

    teardown(function () {
        chrome.browserAction.setTitle.resetHistory();
        chrome.tabs.sendMessage.resetHistory();
    });

    it ("should correctly iterate domain levels", function () {
        let levels = [...CDInjector.iterateDomainLevels("www.google.com")];
        assert.strictEqual(levels.length, 3);
        assert.deepStrictEqual(levels, ["com", "google.com", "www.google.com"]);

        levels = [...CDInjector.iterateDomainLevels("luciopaiva.com")];
        assert.strictEqual(levels.length, 2);
        assert.deepStrictEqual(levels, ["com", "luciopaiva.com"]);

        levels = [...CDInjector.iterateDomainLevels("foo")];
        assert.strictEqual(levels.length, 1);
        assert.deepStrictEqual(levels, ["foo"]);

        levels = [...CDInjector.iterateDomainLevels("")];
        assert.strictEqual(levels.length, 1);
        assert.deepStrictEqual(levels, [""]);
    });

    it ("should be able to splice strings", function () {
        // insert by shifting
        assert.strictEqual(CDInjector.spliceString("foofoo", 3, 3, "bar"), "foobarfoo");
        // insert by replacing the same amount
        assert.strictEqual(CDInjector.spliceString("foobarfoo", 3, 6, "BAR"), "fooBARfoo");
        // insert by replacing with more characters
        assert.strictEqual(CDInjector.spliceString("foobarfoo", 3, 6, "BARBAR"), "fooBARBARfoo");
        // insert by replacing with less characters
        assert.strictEqual(CDInjector.spliceString("foobarfoo", 3, 6, "B"), "fooBfoo");
        // insert at beginning
        assert.strictEqual(CDInjector.spliceString("foobar", 0, 0, ":-)"), ":-)foobar");
        // insert at the end
        assert.strictEqual(CDInjector.spliceString("foobar", 6, 6, "8-D"), "foobar8-D");
        // with line breaks
        assert.strictEqual(CDInjector.spliceString("foo\n\n\nbar", 5, 5, "hello"), "foo\n\nhello\nbar");
    });

    it("should not add same script twice for same tab", function () {
        assert.strictEqual(cdinjector.getScriptNamesForTabId(1).size, 0);
        cdinjector.registerScriptForTabId("foo", 1);
        assert.strictEqual(cdinjector.getScriptNamesForTabId(1).size, 1);
        cdinjector.registerScriptForTabId("foo", 1);
        assert.strictEqual(cdinjector.getScriptNamesForTabId(1).size, 1);
    });

    it("should update interface for given tab", function () {
        sinon.spy(cdinjector, "updateIconWithScriptCount");

        // non-existing tab id, should report zero scripts
        cdinjector.updateInterface(1);
        assert(cdinjector.updateIconWithScriptCount.calledOnce);
        assert(cdinjector.updateIconWithScriptCount.calledWith(0));
        assert(chrome.browserAction.setTitle.calledOnce);

        // erase call history
        cdinjector.updateIconWithScriptCount.resetHistory();
        chrome.browserAction.setTitle.resetHistory();

        // existing tab id, should report 2 scripts
        cdinjector.registerScriptForTabId("foo", 1);
        cdinjector.registerScriptForTabId("bar", 1);
        cdinjector.updateInterface(1);
        assert(cdinjector.updateIconWithScriptCount.calledOnce);
        assert(cdinjector.updateIconWithScriptCount.calledWith(2));
        assert(chrome.browserAction.setTitle.calledOnce);

        // erase call history
        cdinjector.updateIconWithScriptCount.resetHistory();
        chrome.browserAction.setTitle.resetHistory();
    });

    it("should load single script", async function () {
        await cdinjector.loadScript("google.com", "js", sender);

        // check that the message is being sent to the tab
        assert(chrome.tabs.sendMessage.calledOnce);
        const call = chrome.tabs.sendMessage.getCall(0);
        assert.deepStrictEqual(call.args, [
            tabId, {
                scriptType: "js",
                scriptContents: sampleCode
            }, {
                frameId: 0
            }
        ]);
    });

    it("should fetch all relevant scripts for hostname", async function () {
        const globalJs = CDInjector.globalScriptName + ".js";
        const globalCss = CDInjector.globalScriptName + ".css";

        await cdinjector.onScriptRequest("google.com", sender);

        const calls = cdinjector.queryLocalServerForFile.getCalls();

        // must have made a total of 6 of calls: [global, google.com, com] x [js, css]
        assert.strictEqual(calls.length, 6);
        for (const call of calls) {
            assert.strictEqual(call.args.length, 1);
        }

        const actualScriptNames = calls.map(call => call.args[0]);
        assert.deepStrictEqual(actualScriptNames, [
            globalJs, globalCss,
            "com.js", "com.css",
            "google.com.js", "google.com.css"]);
    });

    it("should process include directives", async function () {
        const includeFoo = "// @include foo.js";
        const sampleCodeWithIncludeDirective = `console.info('Hello');\n${includeFoo}\nconsole.info('world');`;
        const fooCode = "// foo";
        const startIndex = sampleCodeWithIncludeDirective.indexOf(includeFoo);
        const endIndex = startIndex + includeFoo.length;
        const finalCode = CDInjector.spliceString(sampleCodeWithIncludeDirective, startIndex, endIndex, fooCode);

        cdinjector.queryLocalServerForFile.reset();
        let callIndex = -1;
        cdinjector.queryLocalServerForFile.onCall(++callIndex).resolves(null);  // _global.js
        cdinjector.queryLocalServerForFile.onCall(++callIndex).resolves(null);  // _global.css
        cdinjector.queryLocalServerForFile.onCall(++callIndex).resolves(sampleCodeWithIncludeDirective);  // com.js
        cdinjector.queryLocalServerForFile.onCall(++callIndex).resolves(fooCode);  // foo.js (included from com.js)
        cdinjector.queryLocalServerForFile.onCall(++callIndex).resolves(null);  // com.css
        await cdinjector.onScriptRequest("com", sender);

        const calls = cdinjector.queryLocalServerForFile.getCalls();
        assert.strictEqual(calls.length, 5);
        const requestedScripts = calls.map(call => call.args[0]);
        assert.deepStrictEqual(requestedScripts, [
            "_global.js",
            "_global.css",
            "com.js",
            "foo.js",
            "com.css",
        ]);

        assert(chrome.tabs.sendMessage.calledOnce);
        const tabMessageCall = chrome.tabs.sendMessage.getCall(0);
        assert.strictEqual(tabMessageCall.args.length, 3);
        assert.strictEqual(tabMessageCall.args[1].scriptContents, finalCode);
    });

});
