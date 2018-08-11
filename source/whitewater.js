// Whitewater object
function Whitewater(canvas, inputPath, options) {
    'use strict';

    var context = null;
    var imageIndex = 0;
    var coordinates = {
        x: 0,
        y: 0
    };
    var imagesLoaded = 0;
    var firstImage = new Image();
    var diffImages = [];
    var animationFrame = null;
    var frames = null;
    var manifest = null;
    var path = '';
    var settings = {};

    // Page Visibility API compatibility
    var hiddenProperty = null;
    var documentHidden = false;

    // Buffer
    var buffer = null;
    var bufferContext = null;

    // Public members
    this.state = 'loading';
    this.currentFrame = 0;
    this.progress = 0;
    this.timestamp = '00:00.000';
    this.maxTime = '00:00.000';
    this.secondsElapsed = 0.0;

    // ---------------------------------------------------------------------- //

    // Private Functions

    var addCanvasMethods = function() {
        this.canvas.play = this.play;
        this.canvas.pause = this.pause;
        this.canvas.playpause = this.playpause;
        this.canvas.stop = this.stop;
    }.bind(this);

    var addVisibilityListener = function() {
        if ('hidden' in document) {
            hiddenProperty = 'hidden';
            document.addEventListener(
                'visibilitychange',
                softPause.bind(this),
                false
            );
        } else if ('mozHidden' in document) {
            hiddenProperty = 'mozHidden';
            document.addEventListener(
                'mozvisibilitychange',
                softPause.bind(this),
                false
            );
        } else if ('msHidden' in document) {
            hiddenProperty = 'msHidden';
            document.addEventListener(
                'msvisibilitychange',
                softPause.bind(this),
                false
            );
        } else if ('webkitHidden' in document) {
            hiddenProperty = 'webkitHidden';
            document.addEventListener(
                'webkitvisibilitychange',
                softPause.bind(this),
                false
            );
        } else if ('onfocusin' in document) {
            document.addEventListener(
                'focusin',
                softPause.bind(this, false),
                false
            );
            document.addEventListener(
                'focusout',
                softPause.bind(this, true),
                false
            );
        } else if ('onpageshow' in window) {
            window.addEventListener(
                'pageshow',
                softPause.bind(this, false),
                false
            );
            window.addEventListener(
                'pagehide',
                softPause.bind(this, true),
                false
            );
        } else {
            window.addEventListener(
                'focus',
                softPause.bind(this, false),
                false
            );
            window.addEventListener('blur', softPause.bind(this, true), false);
        }
    }.bind(this);

    var checkImagesLoaded = function() {
        imagesLoaded++;

        if (imagesLoaded > settings.imagesRequired) {
            this.canvas.setAttribute('data-state', 'ready');
            this.state = 'ready';

            var loadEvent = new CustomEvent(
                'whitewaterload',
                getEventOptions()
            );
            this.canvas.dispatchEvent(loadEvent);

            if (options.autoplay) {
                this.play();
            }
        }
    }.bind(this);

    var drawFrame = function() {
        var frameToDraw = null;

        if (this.currentFrame === 0) {
            frameToDraw = firstImage;
        } else {
            frameToDraw = getPrecompositedFrame(frames[this.currentFrame - 1]);
        }

        context.drawImage(frameToDraw, 0, 0);
        this.currentFrame++;
        setProgress();
    }.bind(this);

    var getEventOptions = function() {
        return {
            detail: {
                video: this,
                currentFrame: this.currentFrame,
                progress: this.progress,
                timestamp: this.timestamp,
                maxTime: this.maxTime,
                state: this.state,
                secondsElapsed: this.secondsElapsed
            },
            bubbles: true,
            cancelable: false
        };
    }.bind(this);

    var getPrecompositedFrame = function(frameToRender) {
        bufferContext.clearRect(
            0,
            0,
            settings.videoWidth,
            settings.videoHeight
        );

        for (var j = 0; j < frameToRender.length; j++) {
            var position = frameToRender[j][0];
            var consecutive = frameToRender[j][1];
            var positionArray = getCoordinatesFromPosition(position);
            var chunkWidth = consecutive * settings.blockSize;

            bufferContext.drawImage(
                diffImages[imageIndex],
                coordinates.x * settings.blockSize,
                coordinates.y * settings.blockSize,
                chunkWidth,
                settings.blockSize,
                positionArray[0] * settings.blockSize,
                positionArray[1] * settings.blockSize,
                chunkWidth,
                settings.blockSize
            );

            coordinates.x += consecutive;
            if (coordinates.x >= settings.sourceGrid) {
                // Jump to next row
                coordinates.x = 0;
                coordinates.y++;
                if (coordinates.y >= settings.sourceGrid) {
                    // Jump to next diffmap
                    coordinates.y = 0;
                    imageIndex++;
                    if (imageIndex >= diffImages.length) {
                        throw 'imageIndex exceeded diffImages.length\n\nmapLength = ' +
                            frameToRender.length +
                            '\nj = ' +
                            j;
                    }
                }
            }
        }

        return buffer;
    };

    var loadRequiredImages = function() {
        firstImage.addEventListener(
            'load',
            function() {
                checkImagesLoaded();
                setPosterImage();
            },
            false
        );
        firstImage.src = path + 'first.' + settings.format;

        for (var i = 1; i <= settings.imagesRequired; i++) {
            var image = new Image();
            image.addEventListener('load', checkImagesLoaded, false);
            if (i > 99) {
                image.src = path + 'diff_' + i + '.' + settings.format;
            } else if (i > 9) {
                image.src = path + 'diff_0' + i + '.' + settings.format;
            } else {
                image.src = path + 'diff_00' + i + '.' + settings.format;
            }
            diffImages.push(image);
        }
    }.bind(this);

    var parseManifestFile = function(callbacks) {
        var request = new XMLHttpRequest();

        request.open('GET', path + 'manifest.json', true);
        request.addEventListener('load', onManifestLoad.bind(this), false);
        request.addEventListener('error', onManifestError.bind(this), false);
        request.send();

        function onManifestLoad() {
            try {
                manifest = JSON.parse(request.responseText);
            } catch (error) {
                this.constructor._throwError(error);
                return;
            }

            setVideoOptions();
            setSize();

            var myWorker = null;

            var webWorker = function() {
                var workerIsIncluded = false;

                workerIsIncluded = true;

                onmessage = function(e) {
                    var frames = e.data;
                    var videoData = [];

                    for (var i = 0; i < frames.length; i++) {
                        var frame = frames[i];
                        var frameData = [];

                        if (frame !== '') {
                            var map = frame.match(/.{1,5}/g);
                            var mapLength = map.length;

                            for (var j = 0; j < mapLength; j++) {
                                var position = toBase10(map[j].substr(0, 3));
                                var consecutive = toBase10(map[j].substr(3, 2));

                                frameData.push([position, consecutive]);
                            }
                        }

                        videoData.push(frameData);
                    }

                    postMessage(videoData);
                };

                function toBase10(val) {
                    var order =
                        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
                    var num = 0,
                        r;
                    while (val.length) {
                        r = order.indexOf(val.charAt(0));
                        val = val.substr(1);
                        num *= 64;
                        num += r;
                    }
                    return num;
                }

                return workerIsIncluded;
            };

            var URL = window.URL || window.webkitURL;
            var workerBlob = new Blob(['(' + webWorker.toString() + ')()'], {
                type: 'text/javascript'
            });
            myWorker = new Worker(URL.createObjectURL(workerBlob));

            myWorker.postMessage(manifest.frames);

            myWorker.onmessage = function(event) {
                frames = event.data;
                myWorker.terminate();

                for (var i = 0; i < callbacks.length; i++) {
                    callbacks[i]();
                }

                if (options.controls) {
                    setPlayPauseControls();
                }
            };
        }

        function onManifestError() {
            try {
                throw this.constructor.errors.MANIFEST;
            } catch (error) {
                this.constructor._throwError(error);
                return;
            }
        }
    }.bind(this);

    var resetVideo = function() {
        imageIndex = 0;
        coordinates.x = 0;
        coordinates.y = 0;
        this.currentFrame = 0;

        context.clearRect(0, 0, settings.videoWidth, settings.videoHeight);
    }.bind(this);

    var setCanvasElement = function() {
        if (canvas instanceof HTMLCanvasElement) {
            this.canvas = canvas;
            context = this.canvas.getContext('2d');
            buffer = document.createElement('canvas');
            bufferContext = buffer.getContext('2d');
        } else {
            throw this.constructor.errors.CANVAS;
        }
    }.bind(this);

    var setFilePath = function() {
        if (typeof inputPath === 'string') {
            path = inputPath;
            if (inputPath.substr(-1) !== '/') {
                path += '/';
            }
        } else {
            throw this.constructor.errors.PATH;
        }
    };

    var setOptions = function() {
        if (options) {
            var speed = 1;
            if (options.speed && options.speed < 1) {
                speed = options.speed;
            }

            options = {
                loop: options.loop || false,
                autoplay: options.autoplay || false,
                controls: options.controls || false,
                speed: speed
            };
        }
    };

    var setPlayPauseControls = function() {
        var element = this.canvas;

        if (typeof options.controls !== 'boolean') {
            element = options.controls;
        }

        var clickEvent = getClickEvent();
        element.addEventListener(clickEvent, this.playpause);
    }.bind(this);

    var setPosterImage = function() {
        var src = firstImage.src;
        var top = this.canvas.style.paddingTop;

        this.canvas.style.background =
            'transparent url(' + src + ') no-repeat center ' + top;
        this.canvas.style.backgroundSize = 'contain';
    }.bind(this);

    var setProgress = function() {
        this.progress = getNumberWithDecimals(
            (this.currentFrame / settings.frameCount) * 100,
            3
        );

        var currentTime = this.currentFrame / settings.framesPerSecond;
        this.timestamp = getFormattedTime(currentTime);
        this.secondsElapsed = getNumberWithDecimals(currentTime, 3);

        // XXX: disabled progress event
        // var playingEvent = new CustomEvent('whitewaterprogressupdate', getEventOptions());
        // this.canvas.dispatchEvent(playingEvent);
    }.bind(this);

    var setSize = function() {
        this.canvas.setAttribute('width', settings.videoWidth + 'px');
        this.canvas.setAttribute('height', settings.videoHeight + 'px');
        buffer.width = settings.videoWidth;
        buffer.height = settings.videoHeight;
    }.bind(this);

    var setVideoOptions = function() {
        var format = '';

        switch (manifest.format) {
            case 'JPEG':
                format = 'jpg';
                break;
            case 'PNG':
                format = 'png';
                break;
            case 'GIF':
                format = 'gif';
                break;
            default:
                format = 'jpg';
                break;
        }

        settings = {
            videoWidth: manifest.videoWidth,
            videoHeight: manifest.videoHeight,
            imagesRequired: manifest.imagesRequired,
            frameCount: manifest.frameCount - 1,
            blockSize: manifest.blockSize,
            sourceGrid: manifest.sourceGrid,
            framesPerSecond: Math.round(manifest.framesPerSecond),
            format: format
        };

        var lengthInSeconds = settings.frameCount / settings.framesPerSecond;
        this.maxTime = getFormattedTime(lengthInSeconds);
    }.bind(this);

    var softPause = function(hidden) {
        if (hidden !== undefined) {
            documentHidden = hidden;
        }

        if (
            (document[hiddenProperty] || documentHidden === true) &&
            Video.state === 'playing'
        ) {
            this.state = 'suspended';
            this.pause();
        } else if (Video.state === 'suspended') {
            this.play();
        }
    };

    var init = function() {
        try {
            setCanvasElement();
            setFilePath();
            setOptions();

            var callAfterManifest = [
                loadRequiredImages,
                addCanvasMethods,
                addVisibilityListener
            ];

            parseManifestFile(callAfterManifest);
        } catch (error) {
            this.constructor._throwError(error);
            return;
        }
    }.bind(this);

    // Helper Functions

    var getClickEvent = function() {
        var isTouchDevice = 'ontouchstart' in document.documentElement;
        // var startEvent = isTouchDevice ? 'touchstart' : 'mousedown';
        var endEvent = isTouchDevice ? 'touchend' : 'mouseup';

        return endEvent;
    };

    var getCoordinatesFromPosition = function(position) {
        var coordinates = [];
        var columns = Math.ceil(settings.videoWidth / settings.blockSize);

        if (position < columns) {
            coordinates = [position, 0];
        } else {
            coordinates = [position % columns, Math.floor(position / columns)];
        }

        return coordinates;
    };

    var getFormattedTime = function(time) {
        var minutes = Math.floor(time / 60);
        var seconds = Math.floor(time % 60);
        var milliseconds = Math.floor(((time % 60) % 1) * 1000);

        if (minutes < 10) {
            minutes = '0' + minutes;
        }

        if (seconds < 10) {
            seconds = '0' + seconds;
        }

        if (milliseconds < 10) {
            milliseconds = '00' + milliseconds;
        } else if (milliseconds < 100) {
            milliseconds = '0' + milliseconds;
        }

        return minutes + ':' + seconds + '.' + milliseconds;
    };

    var getNumberWithDecimals = function(number, digits) {
        var multiplier = Math.pow(10, digits);
        return Math.round(number * multiplier) / multiplier;
    };

    // Public Functions

    var Video = this;

    this.pause = function() {
        if (Video.state === 'paused') {
            return;
        }

        if (Video.state !== 'suspended') {
            Video.canvas.setAttribute('data-state', 'paused');
            Video.state = 'paused';

            var pauseEvent = new CustomEvent(
                'whitewaterpause',
                getEventOptions()
            );
            Video.canvas.dispatchEvent(pauseEvent);
        }

        cancelAnimationFrame(animationFrame);
    };

    this.play = function() {
        if (Video.state === 'playing') {
            return;
        } else if (Video.state === 'ended') {
            resetVideo();
        }

        var resume = Video.state === 'suspended';

        Video.canvas.setAttribute('data-state', 'playing');
        Video.state = 'playing';

        if (!resume) {
            var playEvent = new CustomEvent(
                'whitewaterplay',
                getEventOptions()
            );
            Video.canvas.dispatchEvent(playEvent);
        }

        var milliseconds = (1 / settings.framesPerSecond) * 1000;
        var interval = getNumberWithDecimals(milliseconds / options.speed, 2);
        var previousTime = window.performance.now();

        animate(previousTime);

        function animate(currentTime) {
            var timeSinceLastDraw = currentTime - previousTime;

            if (timeSinceLastDraw >= interval) {
                if (Video.currentFrame < settings.frameCount + 1) {
                    drawFrame();
                } else if (options.loop) {
                    resetVideo();
                    drawFrame();

                    var loopEvent = new CustomEvent(
                        'whitewaterloop',
                        getEventOptions()
                    );
                    Video.canvas.dispatchEvent(loopEvent);
                } else {
                    Video.stop();

                    Video.canvas.setAttribute('data-state', 'ended');
                    Video.state = 'ended';

                    var endEvent = new CustomEvent(
                        'whitewaterend',
                        getEventOptions()
                    );
                    Video.canvas.dispatchEvent(endEvent);
                }

                var lag = timeSinceLastDraw - interval;
                previousTime = currentTime - lag;
            }

            if (
                !(document[hiddenProperty] || documentHidden === true) &&
                Video.state === 'playing'
            ) {
                animationFrame = requestAnimationFrame(animate);
            }
        }
    };

    this.playpause = function() {
        if (Video.state === 'playing') {
            Video.pause();
        } else if (Video.state !== 'loading') {
            Video.play();
        }
    };

    this.stop = function() {
        if (Video.state === 'ready') {
            return;
        }

        Video.canvas.setAttribute('data-state', 'ready');
        Video.state = 'ready';

        var stopEvent = new CustomEvent('whitewaterend', getEventOptions());
        // Video.canvas.dispatchEvent(stopEvent);

        cancelAnimationFrame(animationFrame);

        resetVideo();
        setProgress();
    };

    // Check dependencies and initialize video

    if (Whitewater.supported) {
        init();
    }
}

Whitewater.errors = {
    pre: 'Whitewater: ',
    MISC: 'Whatever.',
    WEBWORKERS: 'This browser does not support Web Workers.',
    BLOBCONSTRUCTOR: 'This browser does not support the Blob() constructor.',
    VISIBILITYAPI: 'This browser does not support the Visiblity API',
    CANVAS: '"canvas" must be a valid HTML canvas element.',
    PATH:
        '"path" must be a path to a directory containing a manifest.json file',
    MANIFEST: 'A manifest.json file could not be found.'
};

Whitewater._checkSupport = function() {
    try {
        if (!window.Blob) {
            throw this.errors.WEBWORKERS;
        } else if (!window.Worker) {
            throw this.errors.BLOBCONSTRUCTOR;
        } else if (
            !(
                'hidden' in document ||
                'mozHidden' in document ||
                'msHidden' in document ||
                'webkitHidden' in document
            )
        ) {
            throw this.errors.VISIBILITYAPI;
        } else {
            return true;
        }
    } catch (error) {
        this._throwError(error);
        return false;
    }
};

Whitewater._throwError = function(error) {
    console.warn(this.errors.pre + error);
};

Whitewater.supported = Whitewater._checkSupport();
