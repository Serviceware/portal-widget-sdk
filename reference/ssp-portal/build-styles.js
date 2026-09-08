module.exports = function createStylesJsString(stylesCss) {
    return `/* ssp-widget-css-isolation */
(()=>{
const stylesLink = document.createElement('link');
stylesLink.rel = 'stylesheet';
stylesLink.type = 'text/css';
stylesLink.href = 'data:text/css;base64,${Buffer.from(stylesCss).toString('base64')}';
document.getElementsByTagName("head")[0].appendChild(stylesLink);})();`;
};
