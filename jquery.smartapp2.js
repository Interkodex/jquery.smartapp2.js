// Open Productivity - Smartapp version 2.31
(function ($) {
    "use strict";

    /* Lightweight jQuery SPA HTML Client Framework */
    /* ---- Making HTML apps as jQuery plugins --- */

    /* - Loads your views from HTML template files */
    /* - Takes care of back/forward browser navigation */
    /* - Wraps your views in handy jquery classes */
    /* - Supplies easy to use WEB API functions (JSON RPC) */
    /* - Can initialize within an existing website, an app (Phonegap supported) or stand alone webapp  */

    // Add any neccessary contructor parameters in side the function () below. Example function (otherControl), this will
    $.fn.smartapp2 = function (serviceUrl, viewsFolder, options) { // <-- Constructor method
        if (this._smartapp_inited) {
            throw "Unintended duplicate call of app plugin. Check that you are not declaring and using a function with the same name as the view app!";
        }
        this._smartapp_inited = true;

        var $app = this;
        var $currentView = null;

        this.ServiceUrl = serviceUrl;
        // Define the jquery class
        this.loaders = 0;
        if (!options) options = {};
        this.options = $.extend({}, options);

        this.SystemErrorMsg = "Sorry, an application error has occured!";

        this.Views = {};
        this.Dialogs = {};
        this.Controls = {};

        this.FailedRetryCalls = null;
        this.FailedCancelCalls = null;
        this.ViewTemplateCache = [];
        this.RetryDialog = null;

        this.IsTouchDevice = "ontouchstart" in document.documentElement;
        this.HasMouse = false;

        // Internal shared create method
        function createComponent(name, renderFunction, initFunction) {
            if (!renderFunction) {
                renderFunction = $app.fetch(name + ".html");
                if (!initFunction) initFunction = $app.runPlugin(name.replace(new RegExp("/", "g"), ""));
            }
            else if (renderFunction instanceof jQuery) {
                var html = $("<div/>").append(renderFunction).html();
                renderFunction.remove();
                renderFunction = function () {
                    var dfd = $.Deferred();
                    dfd.resolveWith(this, [$(html)]);
                    return dfd;
                };
            }

            return {
                name: name,
                renderFunc: renderFunction,
                initFunc: initFunction
            };
        };

        // Public create methods (view, dialog, control)
        this.createView = function (urlRoute, renderFunction, initFunction) {
            if (!$app.DefaultViewRoute) $app.DefaultViewRoute = urlRoute;

            var component = createComponent(urlRoute, renderFunction, initFunction);
            $app.Views[urlRoute] = component;
        };

        this.createDialog = function (name, renderFunction, initFunction) {
            var component = createComponent(name, renderFunction, initFunction);
            $app.Dialogs[name] = component;
        };

        this.createControl = function (name, renderFunction, initFunction) {
            var component = createComponent(name, renderFunction, initFunction);
            $app.Controls[name] = component;
        };

        // Add default show / hide handling of views
        this.on("viewclosing", function (e, $view) {
            $view.hide();
            $view.triggerViewEvents("viewclosed");
            $view.remove();
        });
        this.on("viewshowing", function (e, $view) {
            $view.show();
            $view.triggerViewEvents("viewshowed");
        });

        this.run = function () {
            // Add loading layer
            var $loader = $("<div class=\"loading hide\"><span></span></div>");
            $app.append($loader);

            if ($app.RetryDialogName) {
                var retry = $app.Dialogs[$app.RetryDialogName];
                retry.renderFunc(); // Force cache of retry dialog
            }

            $app.trigger("appinit", [$app]);

            $app.trigger("hashchange");
        };

        this.addFailedCall = function (retry, cancel, xhr) {
            if ($app.FailedRetryCalls == null) {
                $app.FailedRetryCalls = [];
                $app.FailedCancelCalls = [];
                $app.openDialog($app.RetryDialogName, {
                    show: true,
                    keyboard: false,
                    backdrop: "static"
                }).done(function ($dialog) {
                    $app.RetryDialog = $dialog;

                    if ($app.RetryDialog.SetErrorText)
                        $app.RetryDialog.SetErrorText(xhr);
                });
            }
            else if ($app.RetryDialog && $app.RetryDialog.SetErrorText)
                $app.RetryDialog.SetErrorText(xhr);

            if (retry != null) $app.FailedRetryCalls.push(retry);
            if (cancel != null) $app.FailedCancelCalls.push(cancel);
        };

        this.APIGet = function (controller, method, data, opts) {
            var info = "API GET " + controller + "/" + method;
            var startTimer = new Date();
            if (opts == null) opts = {};
            if (data == null) data = {};

            if (opts.cache) opts.cache = true;
            else opts.cache = false;
            $.ajaxSetup({ cache: opts.cache });
            var ajaxcall = null;

            var dfd = $.Deferred();
            controller = controller.replace(new RegExp("/", "g"), "");

            (function nestedCall() {
                if (!opts.background) $app.showLoading(info);
                else $app.log(info);

                ajaxcall = $.ajax({
                    url: $app.ServiceUrl + "/" + controller + "/" + method,
                    dataType: opts.cache ? "json" : (options.disableJsonp ? "json" : "jsonp"),
                    async: true,
                    type: "GET",
                    data: data,
                    cache: opts.cache,
                    beforeSend: function (request, settings) {
                        $app.trigger("beforeapiget", [request, settings]);
                    }
                });

                ajaxcall.then(function (resultObject, textStatus, jqXhr) {
                    // SUCCESS
                    ajaxcall = null; // Prevent any abort call
                    var diffMs = (new Date()).getTime() - startTimer.getTime();
                    if (!opts.background) $app.hideLoading(info + " (" + diffMs + "ms)");
                    else $app.log("SUCCESS: " + info);
                    dfd.resolveWith(this, [resultObject, textStatus, jqXhr]);
                }, function (xhr, ajaxOptions, thrownError) {
                    // FAIL
                    ajaxcall = null; // Prevent any abort call
                    var diffMs = (new Date()).getTime() - startTimer.getTime();
                    if (!opts.background) $app.hideLoading(info + " FAILED (" + diffMs + "ms)");
                    $app.log("FAILED: " + info);

                    if (opts.noretry || $app.RetryDialogName == null) {
                        $app.error(thrownError);
                        dfd.rejectWith(this, [xhr, ajaxOptions, thrownError]);
                    } else {
                        $app.addFailedCall(nestedCall, function () {
                            $app.log("CANCEL RETRY: " + info);
                            dfd.rejectWith(this, [xhr, ajaxOptions, thrownError]);
                        }, xhr);
                    }
                });
            })();

            var promise = dfd.promise();
            promise.abort = function () {
                opts.noretry = true;
                if (ajaxcall != null) ajaxcall.abort();
                ajaxcall = null;
            };
            return promise;
        };
        this.APIPost = function (controller, method, data, opts) {
            var info = "API POST " + controller + "/" + method;
            var startTimer = new Date();
            if (opts == null) opts = {};
            if (data == null) data = {};

            if (opts.cache) opts.cache = true;
            else opts.cache = false;
            $.ajaxSetup({ cache: opts.cache });
            var ajaxcall = null;

            var dfd = $.Deferred();
            controller = controller.replace(new RegExp("/", "g"), "");

            (function nestedCall() {
                if (!opts.background) $app.showLoading(info);
                ajaxcall = $.ajax({
                    type: "POST",
                    url: $app.ServiceUrl + "/" + controller + "/" + method,
                    data: JSON.stringify(data),
                    dataType: "json", // always json
                    contentType: "application/json; charset=utf-8",
                    async: true,
                    cache: opts.cache,
                    beforeSend: function (request, settings) {
                        $app.trigger("beforeapipost", [request, settings]);
                    }
                });

                ajaxcall.then(function (resultObject, textStatus, jqXhr) {
                    // SUCCESS
                    ajaxcall = null; // Prevent any abort call
                    var diffMs = (new Date()).getTime() - startTimer.getTime();
                    if (!opts.background) $app.hideLoading(info + " (" + diffMs + "ms)");
                    dfd.resolveWith(this, [resultObject, textStatus, jqXhr]);
                }, function (xhr, ajaxOptions, thrownError) {
                    // FAIL
                    ajaxcall = null; // Prevent any abort call
                    var diffMs = (new Date()).getTime() - startTimer.getTime();
                    if (!opts.background) $app.hideLoading(info + " FAILED (" + diffMs + "ms) - " + thrownError);
                    if (opts.noretry || $app.RetryDialogName == null) {
                        $app.error(thrownError);
                        dfd.rejectWith(this, [xhr, ajaxOptions, thrownError]);
                    } else {
                        $app.addFailedCall(nestedCall, function () {
                            $app.log("CANCEL RETRY: " + info);
                            dfd.rejectWith(this, [xhr, ajaxOptions, thrownError]);
                        }, xhr);
                    }
                });
            })();

            var promise = dfd.promise();
            promise.abort = function () {
                opts.noretry = true;
                if (ajaxcall != null) ajaxcall.abort();
                ajaxcall = null;
            };
            return promise;
        };
        this.APIDownload = function (controller, method, data, opts) {
            var target = "_blank";
            if (opts && opts.target) target = opts.target;

            var query = "?";
            $.each(data, function (key, value) {
                query += encodeURIComponent(key) + "=" + encodeURIComponent(value) + "&";
            });

            return window.open($app.ServiceUrl + "/" + controller + "/" + method + query, target);
        };

        $(window).on("hashchange", function (e) {
            if (!e) return;

            var result = { cancel: null };
            $(window).trigger("beforeunload", [result]);
            if (result.cancel != null) {
                $.fn.Alert(result.cancel);

                var ourl = e.originalEvent.oldURL;
                var oldHash = "#";
                try {
                    oldHash = ourl.substr(ourl.indexOf("#"));
                }
                catch (e) {
                    // Fix crappy browser support (IE)
                }
                $app.registerHistory(oldHash, "Modified");
                return;
            }

            // history changed because of pushState/replaceState

            if ($currentView != null)
                $currentView.trigger("viewclosing", [$currentView, $app]);

            $app.log("Popped state to: " + location.toString());
            var orgroute = location.hash;
            while (orgroute.indexOf("#") == 0 || orgroute.indexOf("/") == 0)
                orgroute = orgroute.substring(1);
            if (orgroute == "") orgroute = $app.DefaultViewRoute;
            var route = orgroute;
            var params = "";

            // Find current route:
            var view = $app.Views[route];
            if (!view)
                while (route.length > 0) {
                    var view = $app.Views[route + "*"];
                    if (view) {
                        params = orgroute.substring(route.length);
                        break;
                    }
                    route = route.substring(0, route.length - 1);
                }


            if (!view) {
                $app.error("Can't find view (" + orgroute + ")");
                view = $app.Views[$app.DefaultViewRoute];
                location = "#" + $app.DefaultViewRoute;
                return false;
            }

            $app.loadComponent(view, "view").done(function ($view) {
                // Reset states
                $(".modal-backdrop").remove();
                $app.FailedRetryCalls = null;
                $app.FailedCancelCalls = null;
                $app.RetryDialog = null;

                if ($view.loadItem) $view.loadItem(params);
                if ($view.LoadItem) $view.LoadItem(params);
                $view.trigger("viewshowing", [$view]);
                $currentView = $view;
            });
        });
        this.error = function (msg) {
            $app.log("(ERROR) " + msg, true);
        };
        this.getCurrentView = function () {
            return $currentView;
        };
        this.goBack = function () {
            window.history.back();
        };
        this.hideLoading = function (e) {
            $app.loaders--;
            if ($app.loaders <= 0) {
                $app.find(".loading").addClass("hide");
                $app.loaders = 0;
                $app.log("Loading completed '" + e + "' (" + $app.loaders + ")");
                $app.log("-------------------------------------------");
            } else {
                $app.log("Loading phase completed '" + e + "' (" + $app.loaders + ")");
            }
        };
        this.log = function (msg, error) {
            if (window.console && typeof window.console.log !== "undefined") {
                if (error)
                    window.console.error("Smartapp2.JS: " + msg);
                else
                    window.console.log("Smartapp2.JS: " + msg);
            }
        };
        function isFunction(functionToCheck) {
            var getType = {};
            return functionToCheck && getType.toString.call(functionToCheck) === '[object Function]';
        }
        this.loadComponent = function (component, componentType, $container) {
            var dfd = $.Deferred();

            var task = component.renderFunc();
            task.then(function ($component) {
                // Success
                if ($component == null) {
                    $app.error("Component named '" + component.name + "' failed to load!");
                    return null;
                }

                if (component.initFunc)
                    component.initFunc($component);

                if (!$container) $container = $app;
                $component.hide(); // Always load views default hidden
                $container.append($component);
                $component.on(componentType + "init", function () {
                    dfd.resolveWith(this, [$component]);
                });
                $component = $component.smartapp2component($app, componentType);

                $app.log("Success create " + component.name + " (Size: " + $component.html().length + ")");
            }, function (xhr, ajaxOptions, thrownError) {
                // Fail
                dfd.rejectWith(this, [xhr, ajaxOptions, thrownError]);
            });

            return dfd;
        };
        this.runPlugin = function (pluginName) {
            return function ($element) {
                if (isFunction($element[pluginName])) {
                    var $vw = $element[pluginName]($app); // Init jquery plugin on template
                    if ($vw == null) {
                        $app.log("Run plugin " + pluginName + " FAILED or ABORTED! - jQuery plugin with name '" + pluginName + "()' returned null, so either not found call failed!", true);
                        $element.remove();
                    } else if ($app.IsTouchDevice) {
                        // Bugfix for fixed positioning on touch devices
                        $vw.on("focus", "input, textarea, [contenteditable]", function (e) {
                            if (!$app.HasMouse) $app.addClass("fixfixed");
                        }).on("blur", "input, textarea, [contenteditable]", function (e) {
                            $app.removeClass("fixfixed");
                        });
                    }
                }
                else {
                    $app.error("Can't initialize view '" + pluginName + "', corresponding jQuery plugin is undefined!");
                }
            };
        }

        this.fetch = function (filePath) {
            return function () {
                var dfd = $.Deferred();

                var startTimer = new Date();
                $app.log("Load " + filePath + " view");

                var $result = null;

                if ($app.ViewTemplateCache[filePath] != null) {
                    $result = $app.ViewTemplateCache[filePath].clone();
                }

                if ($result == null) {
                    var url = viewsFolder ? (viewsFolder + "/" + filePath) : filePath;

                    $.ajax({
                        url: url,
                        dataType: "html",
                        async: true
                    }).then(function (result, textStatus, jqXhr) {
                        // Success
                        var $tmpl = $(result).filter("*:first");
                        if ($tmpl.length == 0)
                            $app.error("Can't find any DOM element in template '" + filePath + "'. Content was: " + result);
                        $result = $tmpl.clone();
                        $app.ViewTemplateCache[filePath] = $tmpl;


                        var diffMs = (new Date()).getTime() - startTimer.getTime();
                        $app.log("Load completed " + filePath + " view (" + diffMs + "ms)");

                        dfd.resolveWith(this, [$result, textStatus, jqXhr]);

                    }, function (xhr, ajaxOptions, thrownError) {
                        // FAIL
                        // TODO: Retry ?
                        var diffMs = (new Date()).getTime() - startTimer.getTime();
                        $app.error("Load failed " + filePath + " view (" + diffMs + "ms)");
                        dfd.rejectWith(this, [xhr, ajaxOptions, thrownError]);
                    });
                } else {
                    dfd.resolveWith(null, [$result]);
                }

                return dfd;
            };
        };
        this.openDialog = function (name, options) {
            var dialog = $app.Dialogs[name];
            if (!dialog) {
                $app.error("Dialog with name '" + name + "' not registered! Make sure to register all dialogs with the createDialog() function.");
            }

            var task = $app.loadComponent(dialog, "dialog", $currentView).done(function ($dialog) {
                if ($dialog != null) {
                    var $c = $app.getCurrentView();
                    if ($c != null) $c.triggerViewEvents("viewsuspended");
                    $dialog.showDialog(options);
                } else {
                    // TODO: Error
                }
            });
            return task;
        };
        function s4() {
            return Math.floor((1 + Math.random()) * 0x10000)
                       .toString(16)
                       .substring(1);
        };
        function guid() {
            return s4() + s4() + "-" + s4() + "-" + s4() + "-" +
                   s4() + "-" + s4() + s4() + s4();
        };
        this.registerHistory = function (url, title, force, data) {
            if (!data) data = { url: url };
            if (history.state == null) {
                $app.replaceHistory(url, title, data);
                return;
            }
            $app.log("Add History: " + url + " (" + title + ")");
            if (JSON.stringify(history.state) == JSON.stringify(data) && !force) return; // Prevent double post
            if ($app.DisableHistory) {
                $app.DisableHistory = false;
                return;
            }
            if (window.history && history.pushState) {
                history.pushState(data, title, url);
            }
        };
        this.replaceHistory = function (url, title, data) {
            if (!data) data = { url: url };
            if ($app.DisableHistory) {
                $app.log("Replace History (disabled): " + url + " (" + title + ")");
                $app.DisableHistory = false;
                return;
            }
            $app.log("Replace History: " + url + " (" + title + ")");
            if (window.history && history.replaceState) {
                history.replaceState(data, title, url);
            }
        };
        this.showLoading = function (e) {
            $app.loaders++;
            $app.find(".loading").removeClass("hide");
            if (document && document.activeElement) document.activeElement.blur();
            $app.log("Loading " + e + " (" + $app.loaders + ")");
        };
        var altdown = false;
        this.attachKeyShortcuts = function ($view) {
            $(window).off("keydown keyup");
            $(window).on("keydown", function (evt) {
                if (evt.which == 18 /*alt*/ || evt.which == 17 /*ctrl*/) {
                    altdown = true;
                    $view.addClass("shortcuts");
                    return false;
                } else if (altdown) {
                    if (!evt.altKey && !evt.ctrlKey) { // Abort (alt+tab fix)
                        altdown = false;
                        $view.removeClass("shortcuts");
                        return;
                    }
                    var k = String.fromCharCode(evt.which).toLowerCase();
                    var field = $view.find("[data-shortkey=\"" + k + "\"]");
                    if (field.length == 1) {
                        var $f = $(field[0]);
                        var $fe = $f.find(":input,[contenteditable]").not(".skipautofocus,.skipautofocus *,[type=hidden],:hidden").first();
                        $fe.select().focus();
                        evt.preventDefault();
                        $f[0].click();
                        return false;
                    } else if (field.length > 1) {
                        $app.Error("Multiple elements binded to same keyboard key error!");
                    }
                }
            }).on("keyup", function (evt) {
                if (!evt.altKey && !evt.ctrlKey) {
                    altdown = false;
                    $view.removeClass("shortcuts");
                    return false;
                }
            });
        };
        this.on("viewshowed viewrestored dialogshowed", function (e, $component) {
            if ($component.find("[data-shortkey]").length > 0) {
                $app.log("Keyboard shortcut listener attached");
                $app.attachKeyShortcuts($component);
            }
        });
        this.on("viewclosing dialogclosing", function (e, $component) {
            if ($component.find("[data-shortkey]").length > 0) {
                $app.log("Keyboard shortcut listener detached");
                $(window).off("keydown keyup");
            }
        });

        $app.on("mousemove", function () {
            $app.HasMouse = true;
            $app.off("mousemove");
        });

        return this; // Return this jquery control
    };

    $.fn.AlertSettings = {
        OKBtn: "OK, continue!"
    };

    $.fn.Alert = function (message, okfunction, container) {
        if (!container) container = "h2";
        var $m = $("<div class=\"modal fade\"></div>").appendTo("body")
                .html("<div class=\"modal-dialog\"><div class=\"modal-content\">" +
                    "<div class=\"modal-body\"><" + container + ">" + message + "</" + container + "></div>" +
                    "<footer class=\"modal-footer\"><button type=\"button\" autofocus=\"autofocus\" class=\"btn btn-primary\">" + $.fn.AlertSettings.OKBtn + "</button></footer>" +
                    "</div></div>")
                .modal({});
        $m.on("shown.bs.modal", function () { $m.find(".btn-primary").focus(); });
        $m.on("hidden.bs.modal", function () {
            if (okfunction) okfunction();
            $m.remove();
        });
        $m.find(".btn-primary").click(function () {
            $(this).closest(".modal").modal("hide");
        });
    };

    $.fn.ConfirmSettings = {
        OKBtn: "OK, fortsett!",
        CancelBtn: "Avbryt"
    };
    $.fn.Confirm = function (message, okfunction, cancelfunction) {
        var $m = $("<div class=\"modal\"></div>").appendTo("body")
            .html("<div class=\"modal-dialog\"><div class=\"modal-content\">" +
                "<div class=\"modal-body\"><h2>" + message + "</h2></div>" +
                "<footer class=\"modal-footer\"><button type=\"button\" class=\"btn btn-default\">" +
                $.fn.ConfirmSettings.CancelBtn +
                "</button><button type=\"button\" autofocus=\"autofocus\" class=\"btn btn-primary\">" +
                $.fn.ConfirmSettings.OKBtn +
                "</button></footer>" +
                "</div></div>")
            .modal({});


        $m.on("shown.bs.modal", function () { $m.find(".btn-primary").focus(); });
        $m.on("hidden.bs.modal", function () {
            if (cancelfunction) cancelfunction();
            $m.remove();
        });
        $m.find(".btn-primary").focus();
        $m.find(".btn-primary").click(function () {
            cancelfunction = null;
            if (okfunction) okfunction();
            $(this).closest(".modal").modal("hide");
        });
        $m.find(".btn-default").click(function () {
            if (cancelfunction) cancelfunction();
            $(this).closest(".modal").modal("hide");
        });
    };
    $.fn.SelectableTable = function () {
        var $me = this;
        if ($me.SelectableTableInited) return this;
        $me.SelectableTableInited = true;

        $me.off("keydown");
        $me.on("keydown", function (e) {
            var $tr = $me.find("tr:focus");
            if ($tr.length != 1) return true; // Not focused

            if (e.which == 13) {
                $tr.find(">td").first().trigger("click").trigger("dblclick");
                //$me.find(":focus").first().find(">td").first().trigger("click");
            }
            else if (e.which == 38) {
                var $rows = $tr.parent().children(":visible");
                var index = $rows.index($tr);
                if (index > 0) $($rows[index - 1]).focus();

                return false;
            }
            else if (e.which == 40) {
                var $rows = $tr.parent().children(":visible");
                var index = $rows.index($tr);
                if (index < $rows.length) $($rows[index + 1]).focus();
                //$rows.find(":focus").prev().focus();

                return false;
            }
        });

        return this;
    };

    $.fn.smartapp2component = function ($app, componentType) { // <-- Constructor method
        if (this._smartapp_inited) {
            throw "Unintended duplicate call of app plugin. Check that you are not declaring and using a function with the same name as the view app!";
        }
        this._smartapp_inited = true;

        var $me = this;

        function mapControls($e) {
            $e.find("[id]").each(function () {
                var $item = $(this);
                var name = $item.attr("id");
                $me[name] = $item;
            });
            $e.find("[data-control]").each(function () {
                var $item = $(this);
                var name = $item.attr("data-control");
                $me[name] = $me.find("[data-control=\"" + name + "\"]");
            });
        };

        this.find("[data-dlgnav]").on("click", function (e) {
            var btn = $(this);
            if (btn.attr("disabled")) return;
            e.preventDefault();

            btn.attr("disabled", "disabled");

            var dialogName = btn.attr("data-dlgnav");
            if (dialogName == "{close}") {
                $me.modal("hide");
                return;
            } else {
                $app.openDialog(dialogName);
            }
            setTimeout(function () { btn.removeAttr("disabled"); }, 1000);
        });

        this.showDialog = function (options) {
            $me.trigger("dialogshowing", [$me, $app]);
            $me.modal(options).on("hidden.bs.modal", function () {
                $me.trigger("dialogclosed", [$me, $app]);
                $me.remove();
                var $c = $app.getCurrentView();
                if ($c != null) $c.triggerViewEvents("viewrestored");
            }).on("shown.bs.modal", function () {
                $me.trigger("dialogshowed", [$me, $app]);
            });
        };
        this.closeDialog = function () {
            $me.trigger("dialogclosing", [$me, $app]);
            $me.modal("toggle");
        };
        this.triggerViewEvents = function (eventName) {
            $me.trigger(eventName, [$me, $app]);

            $.each($me.ChildControls, function (index, $c) {
                $c.triggerViewEvents(eventName.replace("view", "control"));
            });
        };

        this.ChildControls = [];
        function createChildControls() {
            var dfd = $.Deferred();
            $me.ChildControls = [];
            var c = 0;
            var none = true;
            $me.find("[data-loadcontrol]").each(function (index, item) {
                none = false;
                var $item = $(item);
                var cName = $item.attr("data-loadcontrol");
                c++;
                $me.loadControl(cName, $item).then(function ($c) {
                    $me.ChildControls.push($c);
                    $me[cName] = $c;
                    $c.ContainerView = $me;
                    c--;

                    if (c == 0) {
                        dfd.resolveWith(this, []);
                        $me.trigger("loaded", [$me, $app]);
                    }
                }, function () {
                    c--;
                    $app.error("Failed to create child control '" + cName + "'");
                    if (c == 0) {
                        dfd.resolveWith(this, []);
                    }
                });
            });
            if (none) dfd.resolveWith(this, []);
            return dfd;
        };

        function isFunction(functionToCheck) {
            var getType = {};
            return functionToCheck && getType.toString.call(functionToCheck) === '[object Function]';
        }
        this.loadControl = function (controlName, $container) {
            var dfd = $.Deferred();
            var control = $app.Controls[controlName];
            if (!control)
                $app.error("Control with name '" + controlName + "' not registered. Make sure to register all controls with the createControl(...) funciton.");

            var task = $app.loadComponent(control, "control"); // Load template
            task.then(function ($c) {
                // SUCCESS
                if ($c == null) {
                    $app.error("Load control '" + controlName + "' not found in app!");

                }
                $c.trigger("controlshowing");
                $c.show();
                $container.append($c);

                $c.trigger("controlshowed");

                dfd.resolveWith(this, [$c]);

            }, function () {
                // FAIL
                $app.error("Load control '" + controlName + "' failed!");
                dfd.rejectWith(this, []);
            });

            return dfd;
        };

        mapControls($me);
        createChildControls().done(function () {
            $me.triggerHandler(componentType + "init", [$me, $app]);
        });

        return this;
    };
})(jQuery);