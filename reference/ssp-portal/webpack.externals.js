// Resolve webpack from @angular-devkit/build-angular's tree, not root, so the
// plugin hooks match the compiler Angular hands it.
const path = require('path');
const buildAngularDir = path.dirname(
    require.resolve('@angular-devkit/build-angular/package.json')
);
const webpack = require(require.resolve('webpack', { paths: [buildAngularDir] }));
const SspWidgetCssIsolationPlugin = require('./css-isolation-webpack-plugin');

module.exports = {
    // Enable when debugging external libraries
    //devtool: 'inline-source-map',
    // Enable when debugging
    //optimization: {
    //    minimize: false
    //}
    externals: {
        rxjs: 'rxjs',
        'rxjs/operators': 'rxjs.operators',
        '@angular/core': 'ng.core',
        '@angular/core/rxjs-interop': 'ng.core.rxjsInterop',
        '@angular/core/primitives/signals': 'ng.core.primitives.signals',
        '@angular/animations': 'ng.animations',
        '@angular/router': 'ng.router',
        '@angular/common': 'ng.common',
        '@angular/common/http': 'ng.common.http',
        '@angular/elements': 'ng.elements',
        '@angular/forms': 'ng.forms',
        '@angular/platform-browser': 'ng.platformBrowser',
        '@angular/animations/browser': 'ng.animations.browser',
        '@syncfusion/ej2-base': 'syncfusion.ej2.base',
        '@syncfusion/ej2-angular-base': 'syncfusion.ej2.angular.base',
        '@syncfusion/ej2-angular-buttons': 'syncfusion.ej2.angular.buttons',
        '@syncfusion/ej2-angular-dropdowns': 'syncfusion.ej2.angular.dropdowns',
        '@syncfusion/ej2-angular-grids': 'syncfusion.ej2.angular.grids',
        '@syncfusion/ej2-angular-inputs': 'syncfusion.ej2.angular.inputs',
        '@syncfusion/ej2-angular-lists': 'syncfusion.ej2.angular.lists',
        '@syncfusion/ej2-angular-navigations': 'syncfusion.ej2.angular.navigations',
        '@syncfusion/ej2-angular-popups': 'syncfusion.ej2.angular.popups',
        '@syncfusion/ej2-angular-progressbar': 'syncfusion.ej2.angular.progressbar',
        '@syncfusion/ej2-angular-splitbuttons': 'syncfusion.ej2.angular.splitbuttons'
    },
    plugins: [
        new SspWidgetCssIsolationPlugin({ injectIntoMain: true }),
        // Force all async chunks (e.g., from dynamic imports like ngx-quill) into a single bundle
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })
    ]
};
