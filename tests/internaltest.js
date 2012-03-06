selenese = require('selenese-runner');

Object.keys(selenese)
        .filter(function(elem) { return elem.match(/^test/i) })
        .map(function(key) {
    console.log("executing", key);
    try {
        selenese[key]()
    } catch(e) {
        console.log(e);
        process.exit(-1);
    }
})
