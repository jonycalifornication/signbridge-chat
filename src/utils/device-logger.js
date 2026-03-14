/**
 * Utility for logging device and WebGL capabilities to the console.
 * Helpful for debugging rendering issues on different mobile devices.
 */
export function logDeviceInfo(renderer) {
    try {
        console.groupCollapsed('%c[Device Info]', 'color: #4F46E5; font-weight: bold;');
        console.log('User Agent:', navigator.userAgent);
        
        // Basic screen info
        console.log(`Logical Resolution: ${window.screen.width} x ${window.screen.height}`);
        console.log(`Inner Window: ${window.innerWidth} x ${window.innerHeight}`);
        console.log(`Device Pixel Ratio: ${window.devicePixelRatio}`);
        
        // Touch capability
        const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        console.log(`Touch Device: ${isTouch}`);
        
        // WebGL info
        if (renderer) {
            console.log('Color Space:', renderer.outputColorSpace);
            
            const gl = renderer.getContext();
            if (gl) {
                // Get Unmasked GPU info (e.g. Apple GPU, Mali-G715, Adreno, etc)
                const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
                if (debugInfo) {
                    const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                    const rendererStr = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                    console.log('%cWebGL GPU Vendor:', 'color: #059669;', vendor);
                    console.log('%cWebGL GPU Renderer:', 'color: #059669; font-weight: bold;', rendererStr);
                } else {
                    console.log('WebGL exact GPU info unavailable (WEBGL_debug_renderer_info null)');
                }
                
                // Get standard GL info
                console.log('WebGL Version:', gl.getParameter(gl.VERSION));
                console.log('WebGL Shading Language:', gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
                console.log('Max Texture Size:', gl.getParameter(gl.MAX_TEXTURE_SIZE));
            }
        }
        console.groupEnd();
    } catch (e) {
        console.warn('Failed to log device info:', e);
    }
}
