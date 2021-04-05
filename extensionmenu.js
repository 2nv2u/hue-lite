'use strict';

/**
 * extension hue-lights menu
 * JavaScript Gnome extension for Philips Hue bridges - Menu creator.
 *
 * @author Václav Chlumský
 * @copyright Copyright 2021, Václav Chlumský.
 */

 /**
 * @license
 * The MIT License (MIT)
 *
 * Copyright (c) 2021 Václav Chlumský
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const Clutter = imports.gi.Clutter;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Hue = Me.imports.phue;
const HueEntertainment = Me.imports.phueentertainmentapi;
const PhueRequestype = Me.imports.phueapi.PhueRequestype;
const Utils = Me.imports.utils;
const ColorPicker = Me.imports.colorpicker;
const Util = imports.misc.util;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const Lang = imports.lang;
const Slider = imports.ui.slider;
const GLib = imports.gi.GLib;

const Gettext = imports.gettext;
const _ = Gettext.gettext;

const PhueMenuPosition = {
    CENTER: 0,
    RIGHT: 1,
    LEFT: 2
};

const IconSize = 20;

const PhueIconPack = {
    NONE: 0,
    BRIGHT: 1,
    DARK: 2
};

const StreamState = {
    STOPPED: 0,
    STARTING: 1,
    STOPPING: 2,
    RUNNING: 3,
    FAILED: 4
};

/**
 * PhueMenu class. Provides widget with menu items.
 * 
 * @class PhueMenu
 * @constructor
 * @return {Object} menu widget instance
 */
var PhueMenu = GObject.registerClass({
     GTypeName: 'PhueMenu'
}, class PhueMenu extends PanelMenu.Button {

    /**
     * PhueMenu class initialization
     *  
     * @method _init
     * @private
     */
    _init() {

        super._init(0.0, Me.metadata.name, false);

        this.refreshMenuObjects = {};
        this.oldNotifylight = {};
        this.bridgeInProblem = {}
        this._bridgesInMenu = [];
        this._openMenuDefault = null;
        this._isStreaming = {};

        this._settings = ExtensionUtils.getSettings(Utils.HUELIGHTS_SETTINGS_SCHEMA);
        this._settings.connect("changed", Lang.bind(this, function() {
            if (this.readSettings()) {
                this.rebuildMenu();
            }
            this.setPositionInPanel();
            this.hue.setConnectionTimeout(this._connectionTimeout);
        }));

        this.hue = new Hue.Phue(true);

        this.readSettings();
        this.hue.setConnectionTimeout(this._connectionTimeout);
        this._indicatorPositionBackUp = -1;
        this.setPositionInPanel();

        this.colorPicker = null;

        let icon = new St.Icon({
            gicon : Gio.icon_new_for_string(Me.dir.get_path() + '/media/HueIcons/devicesBridgesV2.svg'),
            style_class : 'system-status-icon',
        });

        let iconEffect = this._getIconBriConEffect(PhueIconPack.BRIGHT);
        icon.add_effect(iconEffect);

        this.add_child(icon);

        this.rebuildMenu();

        this.menu.connect("open-state-changed", () => {
            if (this.menu.isOpen) {
                for (let i in this.hue.instances) {
                        /* this will invoke this.refreshMenu via "all-data" */
                        this.hue.instances[i].getAll();
                }

                if (this._openMenuDefault !== null){
                    this._openMenuDefault.open(false);
                }
            }
        });
    }

    /**
     * Returns effect that can be applied on icon
     * 
     * @method _getIconColorEffect
     * @param {Enum} requested icon effect
     * @return {Object} effect
     */
    _getIconColorEffect(reqEffect) {

        let color;
        switch (reqEffect) {

            case PhueIconPack.BRIGHT:

                color = new Clutter.Color({
                    red: 237,
                    green: 237,
                    blue: 237,
                    alpha: 255
                });
                break;

            case PhueIconPack.DARK:

                color = new Clutter.Color({
                    red: 40,
                    green: 40,
                    blue: 40,
                    alpha: 255
                });
                break;

            default:
        }

        let effect = new Clutter.ColorizeEffect({tint: color});
        return effect;
    }

    /**
     * Returns effect that can be applied on icon
     * 
     * @method _getIconBriConEffect
     * @param {Enum} requested icon effect
     * @return {Object} effect
     */
    _getIconBriConEffect(reqEffect) {

        let bri = 0.0;
        let cont = 0.0;

        let effect = new Clutter.BrightnessContrastEffect();
        switch (reqEffect) {

            case PhueIconPack.BRIGHT:

                bri = 0.8;
                cont = 0.2;
                break;

            case PhueIconPack.DARK:

                bri = 0.2;
                cont = 0.2;
                break;

            default:
        }

        effect.set_brightness(bri);
        effect.set_contrast(cont);
        return effect;
    }

    /**
     * Reads settings into class variables.
     * 
     * @method readSettings
     * @return {Boolean} True if the menu needs rebuild.
     */
    readSettings() {

        let menuNeedsRebuild = false;
        let tmpVal;

        /**
         * this.hue.bridges needs rebuild
         */
        tmpVal = JSON.stringify(this.hue.bridges);

        this.hue.bridges = this._settings.get_value(
            Utils.HUELIGHTS_SETTINGS_BRIDGES
        ).deep_unpack();

        if (tmpVal !== JSON.stringify(this.hue.bridges)) {
            this._bridgesInMenu = [];
            menuNeedsRebuild = true;
        }

        /**
         * this._zonesFirst needs rebuild
         */
        tmpVal = this._zonesFirst;

        this._zonesFirst = this._settings.get_boolean(
            Utils.HUELIGHTS_SETTINGS_ZONESFIRST
        );

        if (tmpVal !== this._zonesFirst) {
            menuNeedsRebuild = true;
        }

        /**
         * this._showScenes needs rebuild
         */
        tmpVal = this._showScenes;

        this._showScenes = this._settings.get_boolean(
            Utils.HUELIGHTS_SETTINGS_SHOWSCENES
        );

        if (tmpVal !== this._showScenes) {
            menuNeedsRebuild = true;
        }

        /**
         * this._compactMenu needs rebuild
         */
        tmpVal = this._compactMenu;

        this._compactMenu = this._settings.get_boolean(
            Utils.HUELIGHTS_SETTINGS_COMPACTMENU
        );

        if (tmpVal !== this._compactMenu) {
            menuNeedsRebuild = true;
        }

        /**
         * this._compactMenuRemember doesn't need rebuild
         */
        this._compactMenuRemember = this._settings.get_boolean(
            Utils.HUELIGHTS_SETTINGS_COMPACTMENU_REMEMBER_OPENED
        );

        /**
         * debug doesn't need rebuild
         */
        Utils.debug = this._settings.get_boolean(
            Utils.HUELIGHTS_SETTINGS_DEBUG
        );

        /**
         * this._iconPack needs rebuild
         */
        tmpVal = this._iconPack;

        this._iconPack = this._settings.get_enum(
            Utils.HUELIGHTS_SETTINGS_ICONPACK
        );

        if (tmpVal !== this._iconPack) {
            menuNeedsRebuild = true;
        }

        /**
         * this._indicatorPosition doesn't need rebuild
         */
        this._indicatorPosition = this._settings.get_enum(
            Utils.HUELIGHTS_SETTINGS_INDICATOR
        );

        /**
         * this._connectionTimeout doesn't need rebuild
         */
        this._connectionTimeout = this._settings.get_int(
            Utils.HUELIGHTS_SETTINGS_CONNECTION_TIMEOUT
        );

        /**
         * this._notifyLights doesn't need rebuild
         */
        this._notifyLights = this._settings.get_value(
            Utils.HUELIGHTS_SETTINGS_NOTIFY_LIGHTS
        ).deep_unpack();

        /**
         * this._entertainment doesn't need rebuild
         */
        this._entertainment = this._settings.get_value(
            Utils.HUELIGHTS_SETTINGS_ENTERTAINMENT
        ).deep_unpack();
        return menuNeedsRebuild;
    }

    /**
     * Gets the group color based on lights turned on.
     * 
     * @method _getGroupColor
     * @param {String} bridgeid
     * @param {Number} groupid
     * @return {Object} avarage RGB color
     */
    _getGroupColor(bridgeid, groupid) {
        let counter = 0;
        let r = 0;
        let g = 0;
        let b = 0;

        for (let lightid of this.bridesData[bridgeid]["groups"][groupid]["lights"]) {

            if (!this.bridesData[bridgeid]["lights"][lightid]["state"]["on"]) {
                continue;
            }

            if (this.bridesData[bridgeid]["lights"][lightid]["state"]["xy"] === undefined) {
                continue;
            }

            let [tmpR, tmpG, tmpB] = Utils.xyBriToColor(
                this.bridesData[bridgeid]["lights"][lightid]["state"]["xy"][0],
                this.bridesData[bridgeid]["lights"][lightid]["state"]["xy"][1],
                255 /* or value["bri"] */
            );

            r += tmpR;
            g += tmpG;
            b += tmpB;

            counter++;
        }

        if (counter > 0) {
            r = Math.round(r/counter);
            g = Math.round(g/counter);
            b = Math.round(b/counter);
        }

        return [r, g, b];
    }

    /**
     * Gets the group brightness based on lights turned on.
     * 
     * @method _getGroupBrightness
     * @param {String} bridgeid
     * @param {Number} groupid
     * @return {Object} avarage brightness
     */
    _getGroupBrightness(bridgeid, groupid) {
        let counter = 0;
        let value = 0;

        if (this.bridesData[bridgeid]["groups"][groupid] === undefined) {
            return value;
        }

        if (this.bridesData[bridgeid]["groups"][groupid]["lights"] === undefined) {
            return value;
        }

        for (let lightid of this.bridesData[bridgeid]["groups"][groupid]["lights"]) {

            if (!this.bridesData[bridgeid]["lights"][lightid]["state"]["on"]) {
                continue;
            }

            if (this.bridesData[bridgeid]["lights"][lightid]["state"]["bri"] === undefined) {
                continue;
            }

            value += this.bridesData[bridgeid]["lights"][lightid]["state"]["bri"];
            counter++;
        }

        if (counter > 0) {
            value = Math.round(value/counter);
        }

        return value;
    }

    /**
     * Generate almoust useless ID number
     * 
     * @method _rndID
     * @private
     * @return {Number} randomly generated number
     */
    _rndID () {

        /* items in this.refreshMenuObjects may occure more then ones,
         * this way it is possible - otherwise, the ID is useless
         */
        return Math.round((Math.random()*1000000));
    }

    /**
     * Process entertainment data for
     * "switchEntertainment" event.
     * 
     * @method _switchEntertainmentProcess
     * @param {Object} data for event
     */
    _switchEntertainmentProcess(data) {

        let bridgeid = data["bridgeid"];
        let object = data["object"];
        let bridgePath = data["bridgePath"];
        let parsedBridgePath = [];

        parsedBridgePath = bridgePath.split("::");

        parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

        if (!this.hue.instances[bridgeid].isConnected()){
            object.state = false;
            this._checkHueLightsIsStreaming(bridgeid);
            return;
        }

        if (parsedBridgePath[1] !== "groups") {
            object.state = false;
            return;
        }

        switch (this._isStreaming[bridgeid]["state"]) {
            case StreamState.STOPPED:
                if (object.state) {
                    /* start streaming */

                    if (!this._checkClientKey(bridgeid)) {
                        object.state = false;
                        break;
                    }

                    if (this._checkAnyEntertainmentActive(bridgeid)) {
                        object.state = false;
                        break;
                    }

                    this._isStreaming[bridgeid]["groupid"] = parsedBridgePath[2];

                    this._isStreaming[bridgeid]["state"] = StreamState.STARTING;

                    /* ask to start a new stream with new service */
                    this.hue.instances[bridgeid].enableStream(
                        parsedBridgePath[2],
                    );
                } else {
                    /* other aplication is streaming - disable it */
                    this.hue.instances[bridgeid].disableStream(
                        parsedBridgePath[2],
                    );
                }

                break;

            case StreamState.STARTING:
                if (object.state) {
                    this._isStreaming[bridgeid]["state"] = StreamState.FAILED;
                    this._checkHueLightsIsStreaming(bridgeid);
                    break;
                }

                object.state = true;
                break;

            case StreamState.STOPPING:
                if (!object.state) {
                    this._isStreaming[bridgeid]["state"] = StreamState.FAILED;
                    this._checkHueLightsIsStreaming(bridgeid);
                    break;
                }

                object.state = false;
                break;

            case StreamState.RUNNING:

                if (this._isStreaming[bridgeid]["groupid"] !== parsedBridgePath[2]) {
                    object.state = false;

                    Utils.logDebug(`Entertainment group ${this._isStreaming[bridgeid]["groupid"]} is already streaming.`);
                    break;
                }

                if (!object.state) {
                    /* stop streaming */

                    this._isStreaming[bridgeid]["state"] = StreamState.STOPPING;

                    this.hue.instances[bridgeid].disableStream(
                        parsedBridgePath[2],
                    );

                    if (this._isStreaming[bridgeid]["entertainment"] === undefined) {
                        break;
                    }
                }

                break;

            default:
                break;
        }

        return;
    }

    /**
     * Handles events generated by menu items.
     * 
     * @method _menuEventHandler
     * @private
     * @param {Object} dictionary with instruction what to do
     */
    _menuEventHandler(data) {

        let bridgeid = data["bridgeid"];
        let type = data["type"];
        let object = data["object"];
        let bridgePath = data["bridgePath"];
        let parsedBridgePath = [];
        let value;
        let colorTemperature;
        let cmd = {};

        if (this.bridesData[bridgeid].length === 0) {
            return;
        }

        Utils.logDebug(`Menu event handler type: ${type}, ${bridgeid}, ${bridgePath}`);

        parsedBridgePath = bridgePath.split("::");

        switch(type) {

            case "switch":
                parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

                value = object.state;

                if (parsedBridgePath[1] == "groups") {
                    this.hue.instances[bridgeid].actionGroup(
                        parsedBridgePath[2],
                        {"on": value}
                    );
                }

                if (parsedBridgePath[1] == "lights") {
                    this.hue.instances[bridgeid].setLights(
                        parsedBridgePath[2],
                        {"on": value}
                    );
                }

                if (parsedBridgePath[1] == "sensors") {
                    this.hue.instances[bridgeid].setSensor(
                        parsedBridgePath[2],
                        {"on": value}
                    );
                }

                break;

            case "switchEntertainment":

                this._switchEntertainmentProcess(data);
                break;

            case "entertainmentIntensity":

                value = Math.round(object.value * 254);

                /* 40 is the reasonable minimum */
                this._isStreaming[bridgeid]["intensity"] = 254 - value + 40;
                if (this._isStreaming[bridgeid]["entertainment"]) {
                    this._isStreaming[bridgeid]["entertainment"].setIntensity(
                        this._isStreaming[bridgeid]["intensity"]
                    );
                }
                break;

            case "entertainmentBrightness":

                value = Math.round(object.value * 254);

                this._isStreaming[bridgeid]["brightness"] = value;
                if (this._isStreaming[bridgeid]["entertainment"]) {
                    this._isStreaming[bridgeid]["entertainment"].setBrightness(
                        this._isStreaming[bridgeid]["brightness"]
                    );
                }
                break;

            case "entertainmentMode":

                if (object.value <= 0.33) {
                    value = Utils.entertainmentMode.SYNC;
                    object.value = 0;
                }

                if (object.value > 0.33 && object.value <= 0.66) {
                    value = Utils.entertainmentMode.CURSOR;
                    object.value = 0.5;
                }

                if (object.value > 0.66) {
                    value = Utils.entertainmentMode.RANDOM;
                    object.value = 1;
                }

                data["objectLabel"].set_text(Utils.entertainmentModeText[value]);

                this._isStreaming[bridgeid]["entertainmentMode"] = value;

                if (this._isStreaming[bridgeid] !== undefined &&
                    this._isStreaming[bridgeid]["state"] === StreamState.RUNNING) {

                    this._startEntertainmentStream(
                        bridgeid,
                        this._isStreaming[bridgeid]["groupid"]
                    );
                }
                break;

            case "brightness-colorpicker":

                data["object"] = this.colorPicker.brightness;
                object = data["object"];
                /* no break here "brightness" continues */

            case "brightness":

                parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

                value = Math.round(object.value * 254);
                if (value == 0) {
                    cmd = {"on": false, "bri": value};
                } else {
                    cmd = {"on": true, "bri": value};
                }


                if (parsedBridgePath[1] === "groups") {
                    let groupBrightness = this._getGroupBrightness(bridgeid, parsedBridgePath[2]);
                    if (groupBrightness > 0) {
                        /* some lights are already on, do not turn on the rest */
                        delete(cmd["on"]);
                    }
                }

                if (parsedBridgePath[1] === "groups") {

                    this.hue.instances[bridgeid].actionGroup(
                        parseInt(parsedBridgePath[2]),
                        cmd
                    );
                }

                if (parsedBridgePath[1] === "lights") {

                    this.hue.instances[bridgeid].setLights(
                        parsedBridgePath[2],
                        cmd
                    );
                }

                break;

            case "color-picker":

                /* close the main manu */
                this.menu.close(false);

                if (this.colorPicker !== null) {
                    this.colorPicker.destroy();
                }

                if (this._checkEntertainmentStream(bridgeid, parsedBridgePath)) {
                    break;
                }

                this.colorPicker = new ColorPicker.ColorPicker();
                this.colorPicker.show();
                this.colorPicker.connect("finish", () => {
                    this.colorPicker = null;
                });

                let dataColor = Object.assign({}, data);
                dataColor["type"] = "set-color";
                this.colorPicker.connect(
                    "color-picked",
                    this._menuEventHandler.bind(this, dataColor)
                );

                let dataBrightness = Object.assign({}, data);
                dataBrightness["type"] = "brightness-colorpicker";
                this.colorPicker.connect(
                    "brightness-picked",
                    this._menuEventHandler.bind(this, dataBrightness)
                );
                this.colorPicker.newPosition();

                break;

            case "set-color":

                parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

                value = Utils.colorToHueXY(
                    this.colorPicker.r,
                    this.colorPicker.g,
                    this.colorPicker.b
                );
                colorTemperature = this.colorPicker.colorTemperature;

                cmd = {"on": true};

                if (colorTemperature > 0 &&
                    this.colorPicker.isWhiteTemperature) {

                    cmd["ct"] = Utils.kelvinToCt(colorTemperature);
                } else {
                    cmd["xy"] = value;
                }

                if (parsedBridgePath[1] === "groups") {
                    let groupBrightness = this._getGroupBrightness(bridgeid, parsedBridgePath[2]);
                    if (groupBrightness > 0) {
                        /* some lights are already on, do not turn on the rest */
                        delete(cmd["on"]);
                    }
                }

                if (parsedBridgePath[1] == "groups") {

                    this.hue.instances[bridgeid].actionGroup(
                        parsedBridgePath[2],
                        cmd
                    );
                }

                if (parsedBridgePath[1] == "lights") {

                    this.hue.instances[bridgeid].setLights(
                        parsedBridgePath[2],
                        cmd
                    );
                }

                break;

            case "scene":

                cmd = {
                    "scene": object,
                    "transitiontime": 4
                };

                this.hue.instances[bridgeid].actionGroup(
                    data["groupid"],
                    cmd
                );

                break;

            default:
                Utils.logDebug(`Menu event handler - uknown type ${type}`)
        }

        /* don't call this.refreshMenu() now... it will by called async */
    }

    /**
     * Tries to discovery secondary sensor with temperature.
     * 
     * @method _tryaddSensorsTemperature
     * @param {Number} bridgeid
     * @param {String} uniqueid of primary sensor
     * @param {Object} data to search
     * @return {Object} lable for displaying temperature
     */
    _tryaddSensorsTemperature(bridgeid, uniqueid, data) {

        let temperatureLabel = null;
        for (let i in data["sensors"]) {

            if (data["sensors"][i]["uniqueid"] === undefined) {
                continue;
            }

            if (data["sensors"][i]["uniqueid"].split("-")[0] !== uniqueid) {
                continue;
            }

            if (data["sensors"][i]["state"] === undefined ||
                data["sensors"][i]["state"]["temperature"] === undefined) {
                continue;
            }

            temperatureLabel = new St.Label();
            temperatureLabel.text = "°C";

            temperatureLabel.set_x_align(Clutter.ActorAlign.END);
            temperatureLabel.set_x_expand(false);

            let bridgePath = `${this._rndID()}::sensors::${i}::state::temperature`;

            this.refreshMenuObjects[bridgePath] = {
                "bridgeid": bridgeid,
                "object": temperatureLabel,
                "type": "temperature",
                "tmp": false
            }

            break;
        }

        return temperatureLabel;
    }

    /**
     * Tries to discovery secondary sensor with light level.
     * 
     * @method _tryaddSensorsLightLevel
     * @param {Number} bridgeid
     * @param {String} uniqueid of primary sensor
     * @param {Object} data to search
     * @return {Object} lable for displaying light level
     */
    _tryaddSensorsLightLevel(bridgeid, uniqueid, data) {

        let lightLabel = null;
        for (let i in data["sensors"]) {

            if (data["sensors"][i]["uniqueid"] === undefined) {
                continue;
            }

            if (data["sensors"][i]["uniqueid"].split("-")[0] !== uniqueid) {
                continue;
            }

            if (data["sensors"][i]["state"] === undefined ||
                data["sensors"][i]["state"]["lightlevel"] === undefined) {
                continue;
            }

            lightLabel = new St.Label();
            lightLabel.text = "lux";

            lightLabel.set_x_align(Clutter.ActorAlign.END);
            lightLabel.set_x_expand(false);

            let bridgePath = `${this._rndID()}::sensors::${i}::state::lightlevel`;

            this.refreshMenuObjects[bridgePath] = {
                "bridgeid": bridgeid,
                "object": lightLabel,
                "type": "light-level",
                "tmp": false
            }

            break;
        }

        return lightLabel;
    }

    /**
     * Tries to discovery battery level of sensor.
     * 
     * @method _tryaddSensorsBattery
     * @param {Number} bridgeid
     * @param {String} sensorid of the sensor
     * @param {Object} data to search
     * @return {Object} lable for displaying battery level
     */
    _tryaddSensorsBattery(bridgeid, sensorid, data) {

        if (data["sensors"][sensorid]["config"]["battery"] === undefined) {
            return null;
        }

        let batteryLabel = new St.Label();
        batteryLabel.text = "%";

        batteryLabel.set_x_align(Clutter.ActorAlign.END);
        batteryLabel.set_x_expand(false);

        let bridgePath = `${this._rndID()}::sensors::${sensorid}::config::battery`;

        this.refreshMenuObjects[bridgePath] = {
            "bridgeid": bridgeid,
            "object": batteryLabel,
            "type": "battery",
            "tmp": false
        }

        return batteryLabel;
    }

    /**
     * Tries to discovery sensor switch.
     * 
     * @method _tryaddSensorsSwitch
     * @param {Number} bridgeid
     * @param {String} sensorid of the sensor
     * @param {Object} data to search
     * @return {Object} switch for switching the sensor
     */
    _tryaddSensorsSwitch(bridgeid, sensorid, data) {

        let switchBox = null;
        let switchButton = null;

        if (data["sensors"][sensorid]["config"]["on"] === undefined) {
            return null;
        }

        let bridgePath = `${this._rndID()}::sensors::${sensorid}::config::on`;

        switchBox = new PopupMenu.Switch(false);
        switchButton = new St.Button({reactive: true, can_focus: true});
        switchButton.set_x_align(Clutter.ActorAlign.END);
        switchButton.set_x_expand(false);
        switchButton.child = switchBox;
        switchButton.connect(
            "button-press-event",
            Lang.bind(this, function() {
                switchBox.toggle();
            })
        );
        switchButton.connect(
            "button-press-event",
            this._menuEventHandler.bind(
                this,
                {
                    "bridgePath": bridgePath,
                    "bridgeid": bridgeid,
                    "object":switchBox,
                    "type": "switch"
                }
            )
        );

        this.refreshMenuObjects[bridgePath] = {
            "bridgeid": bridgeid,
            "object":switchBox,
            "type": "switch",
            "tmp": false
        }

        return switchButton;
    }

    /**
     * Creates item (like switch or light sensor)
     * for submenu of sensors.
     * 
     * @method _createItemSensor
     * @param {Number} bridgeid
     * @param {String} sensorid of the sensor
     * @param {Object} data to search
     * @return {Object} menuitem of the sensor
     */
    _createItemSensor(bridgeid, sensorid, data) {

        let sensorIcon = null;
        let uniqueid = data["sensors"][sensorid]["uniqueid"].split("-")[0];

        let item = new PopupMenu.PopupMenuItem(
            data["sensors"][sensorid]["name"]
        )

        item.label.set_x_expand(true);

        sensorIcon = this._tryGetSensorIcon(data["sensors"][sensorid]);

        if (sensorIcon !== null) {
            item.insert_child_at_index(sensorIcon, 1);
        }

        let temperature = this._tryaddSensorsTemperature(bridgeid, uniqueid, data);
        if (temperature !== null) {
            item.add(temperature);
        }


        let lightlevel = this._tryaddSensorsLightLevel(bridgeid, uniqueid, data);
        if (lightlevel !== null) {
            item.add(lightlevel);
        }

        let battery = this._tryaddSensorsBattery(bridgeid, sensorid, data);
        if (battery !== null) {
            item.add(battery);

            let icon = this._getIconByPath(Me.dir.get_path() + '/media/battery.svg');

            if (icon !== null) {
                item.add(icon);
            }
        }

        let sensorSwitch = this._tryaddSensorsSwitch(bridgeid, sensorid, data);
        if (sensorSwitch !== null) {
            item.add(sensorSwitch);
        }

        return item;
    }

    /**
     * Creates menu items for switching bridges.
     * 
     * @method _createOtherBridgesItems
     * @param {String} bridgeid
     * @return {Object} array of menu items
     */
    _createOtherBridgesItems(bridgeid) {
        let items = [];
        let switchesCounter = 0;

        /**
         * if more then one bridge is displayed in menu
         * then all bridges will be displayed,
         * no need for switching item
         */
        if (this._bridgesInMenu.length > 1) {
            return items;
        }

        for (let bridgeid in this.hue.instances) {

            let found = false;
            for (let i of this._bridgesInMenu) {
                if (bridgeid === i) {
                    found = true;
                    break;
                }
            }

            if (!found) {
                if (this.bridesData[bridgeid] === undefined ||
                    this.bridesData[bridgeid]["config"] === undefined) {
                    continue;
                }

                let switchItem = new PopupMenu.PopupMenuItem(
                    _("Switch to") + ` ${this.bridesData[bridgeid]["config"]["name"]}`
                )

                if (this._iconPack !== PhueIconPack.NONE) {
                    let iconPath;

                    switch (this.bridesData[bridgeid]["config"]["modelid"]) {

                        case "BSB001":
                            iconPath = Me.dir.get_path() + `/media/HueIcons/devicesBridgesV1.svg`;
                            break;

                        case "BSB002":
                            iconPath = Me.dir.get_path() + `/media/HueIcons/devicesBridgesV2.svg`;
                            break;

                        default:
                            iconPath = Me.dir.get_path() + `/media/HueIcons/devicesBridgesV2.svg`;
                     }

                    let icon = this._getIconByPath(iconPath);

                    if (icon !== null) {
                        switchItem.insert_child_at_index(icon, 1);
                    }
                }

                switchItem.connect(
                    "button-press-event",
                    () => {
                        this._bridgesInMenu = [bridgeid];
                        this.rebuildMenu();
                    }
                );

                items.push(switchItem);

                switchesCounter++;
            }
        }

        if (switchesCounter > 0) {
            items.push(new PopupMenu.PopupSeparatorMenuItem());
        }

        return items;
    }

    /**
     * Creates bridge submenu with sensors
     * and settings.
     * 
     * @method _createSubMenuBridge
     * @param {Number} bridgeid
     * @param {Object} data to search
     * @return {Object} submenuitem of the bridge
     */
     _createSubMenuBridge(bridgeid, data) {

        let item;
        let sensorCount = 0;
        let iconPath;
        let icon;

        item = new PopupMenu.PopupSubMenuMenuItem(
            data["config"]["name"]
        );

        if (this._iconPack !== PhueIconPack.NONE) {
            switch (data["config"]["modelid"]) {

                case "BSB001":
                    iconPath = Me.dir.get_path() + `/media/HueIcons/devicesBridgesV1.svg`;

                    Utils.logDebug("Bridge is version 1");
                    break;

                case "BSB002":
                    iconPath = Me.dir.get_path() + `/media/HueIcons/devicesBridgesV2.svg`;

                    Utils.logDebug("Bridge is version 2");
                    break;

                default:
                    iconPath = Me.dir.get_path() + `/media/HueIcons/devicesBridgesV2.svg`;

                    Utils.logDebug("Bridge version unknown");
            }

            icon = this._getIconByPath(iconPath);

            if (icon !== null) {
                item.insert_child_at_index(icon, 1);
            }
        }

        for (let i in data["sensors"]) {

            if (data["sensors"][i]["uniqueid"] === undefined) {
                continue;
            }

            if (data["sensors"][i]["capabilities"] === undefined) {
                continue;
            }

            if (data["sensors"][i]["capabilities"]["primary"] === undefined) {
                continue;
            }

            if (data["sensors"][i]["capabilities"]["primary"]) {
                item.menu.addMenuItem(
                    this._createItemSensor(bridgeid, i, data)
                );

                sensorCount++;
            }
        }

        if (sensorCount > 0) {
            /* we have some sensors, create a separator item */
            item.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        for (let otherBridgesItem of this._createOtherBridgesItems(bridgeid)) {
            item.menu.addMenuItem(otherBridgesItem);
        }

        for (let settingsItem of this._createSettingItems(false)) {
            item.menu.addMenuItem(settingsItem);
        }

        return item;
    }

    /**
     * Creates slider for controlling the brightness
     * 
     * @method _createBrightnessSlider
     * @param {String} bridgeid
     * @param {Number} lightid
     * @param {Number} groupid
     * @return {Object} Brightness slider
     */
    _createBrightnessSlider(bridgeid, lightid, groupid, tmp = false) {

        let bridgePath = "";

        let slider = new Slider.Slider(0);
        slider.set_width(150);
        slider.set_x_align(Clutter.ActorAlign.START);
        slider.set_x_expand(false);
        slider.value = 100/254;

        this._createSliderColor(slider, bridgeid, lightid, groupid, tmp);

        if (groupid !== null) {
            bridgePath = `${this._rndID()}::groups::${groupid}::action::bri`;
        } else {
            bridgePath = `${this._rndID()}::lights::${lightid}::state::bri`;
        }

        slider.connect(
            "drag-end",
            this._menuEventHandler.bind(
                this,
                {
                    "bridgePath": bridgePath,
                    "bridgeid": bridgeid,
                    "object":slider,
                    "type": "brightness"
                }
            )
        );

        this.refreshMenuObjects[bridgePath] = {
            "bridgeid": bridgeid,
            "object":slider,
            "type": "brightness",
            "tmp": tmp
        }

        return slider;
    }

    /**
     * Creates switch button for turning the light on/off
     * 
     * @method _createLightSwitch
     * @param {String} bridgeid
     * @param {Number} lightid
     * @param {Number} groupid
     * @return {Object} switch button
     */
    _createLightSwitch(bridgeid, lightid, groupid) {

        let bridgePath = "";

        if (groupid !== null) {
            bridgePath = `${this._rndID()}::groups::${groupid}::state::all_on`;
        } else {
            bridgePath = `${this._rndID()}::lights::${lightid}::state::on`;
        }

        let switchBox = new PopupMenu.Switch(false);
        let switchButton = new St.Button(
            {reactive: true, can_focus: true}
        );

        switchButton.set_x_align(Clutter.ActorAlign.END);
        switchButton.set_x_expand(false);
        switchButton.child = switchBox;
        switchButton.connect(
            "button-press-event",
            Lang.bind(this, function() {
                switchBox.toggle();
            })
        );
        switchButton.connect(
            "button-press-event",
            this._menuEventHandler.bind(
                this,
                {
                    "bridgePath": bridgePath,
                    "bridgeid": bridgeid,
                    "object": switchBox,
                    "type": "switch"
                }
            )
        );

        this.refreshMenuObjects[bridgePath] = {
            "bridgeid": bridgeid,
            "object": switchBox,
            "type": "switch",
            "tmp": true
        }

        return switchButton;
    }

    /**
     * Colorizes slideres based on light color.
     * 
     * @method _createLightSwitch
     * @param {Object} slider to colorize
     * @param {String} bridgeid
     * @param {Number} lightid
     * @param {Number} groupid
     * @param {Boolean} tmp: true for tmp refresh
     */
    _createSliderColor(slider, bridgeid, lightid, groupid, tmp) {

        let bridgePath = "";

        if (groupid === null && this.bridesData[bridgeid]["lights"][lightid]["state"]["xy"] === undefined) {
            return;
        }

        if (groupid !== null && this.bridesData[bridgeid]["groups"][groupid]["action"]["xy"] === undefined) {
            return;
        }

        if (groupid !== null) {
            bridgePath = `${this._rndID()}::groups::${groupid}::action`;
        } else {
            bridgePath = `${this._rndID()}::lights::${lightid}::state`;
        }

        this.refreshMenuObjects[bridgePath] = {
            "bridgeid": bridgeid,
            "object": slider,
            "type": "slider-color",
            "tmp": tmp
        }
    }

    /**
     * Creates last item in menu hierarchy with all the controls.
     * 
     * @method _createItemLight
     * @private
     * @param {String} bridgeid which bridge we use here
     * @param {Object} dictionary data for the bridgeid
     * @param {Number} lightid of created light (not used if groupid provided)
     * @param {Number} groupid creates menu item for all lights (not mandatory)
     * @return {Object} menuitem with light controls
     */
    _createItemLight(bridgeid, data, lightid, groupid, useCompact = false) {

        let light;
        let bridgePath = "";
        let lightIcon = null;

        /**
         * Decide if this is item for one light or a group.
         */
        if (groupid !== null) {
            light = new PopupMenu.PopupMenuItem(
                _("All")
            );
        } else {
            light = new PopupMenu.PopupMenuItem(
                data["lights"][lightid]["name"]
            );
        }

        let label = light.label
        light.remove_child(light.label);
        let itemBox = new St.BoxLayout();
        itemBox.vertical = true;
        itemBox.add(label);
        light.insert_child_at_index(itemBox, 1);

        light.set_x_align(Clutter.ActorAlign.FILL);
        light.label.set_x_expand(true);

        if (groupid === null) {
            lightIcon = this._tryGetLightIcon(data["lights"][lightid]);
        } else {
            if (this._iconPack !== PhueIconPack.NONE) {
                    lightIcon = this._getIconByPath(
                    Me.dir.get_path() + `/media/HueIcons/bulbGroup.svg`
                );
            }
        }

        if (lightIcon !== null) {
            light.insert_child_at_index(lightIcon, 1);
        }

        /**
         * Open color picker on mouse click (standard menu)
         */
        if (groupid !== null) {
            bridgePath = `${this._rndID()}::groups::${groupid}::action::hue`;
        } else {
            bridgePath = `${this._rndID()}::lights::${lightid}::state::hue`;
        }

        if (!useCompact) {
            light.connect(
                'button-press-event',
                this._menuEventHandler.bind(
                    this,
                    {
                        "bridgePath": bridgePath,
                        "bridgeid": bridgeid,
                        "object":light, "type":
                        "color-picker"
                    }
                )
            );
        }

        if (useCompact) {
            light.connect(
                'button-press-event',
                () => {
                    if (groupid !== null) {
                        this._compactBridgesMenu[bridgeid]["control"]["object"].label.text = _("All");
                    } else {
                        this._compactBridgesMenu[bridgeid]["control"]["object"].label.text = data["lights"][lightid]["name"];
                    }

                    this._compactBridgesMenu[bridgeid]["control"]["object"].menu.removeAll();

                    let controlItem = new PopupMenu.PopupMenuItem(
                        _("None")
                    )

                    controlItem.remove_child(controlItem.label);

                    let colorPickerBox = new ColorPicker.ColorPickerBox();

                    this.colorPicker = colorPickerBox;

                    let dataColor = {
                        "bridgeid": bridgeid,
                        "bridgePath": bridgePath,
                        "type": "set-color"
                    }

                    colorPickerBox.connect(
                        "color-picked",
                            this._menuEventHandler.bind(this, dataColor)
                    );

                    let dataBrightness = {
                        "bridgeid": bridgeid,
                        "bridgePath": bridgePath,
                        "type": "brightness-colorpicker"
                    }

                    colorPickerBox.connect(
                        "brightness-picked",
                        this._menuEventHandler.bind(this, dataBrightness)
                    );

                    controlItem.add(colorPickerBox.createColorBox());

                    this._compactBridgesMenu[bridgeid]["control"]["object"].menu.addMenuItem(controlItem);

                    if (this._compactBridgesMenu[bridgeid]["control"]["switch"] != null){
                        this._compactBridgesMenu[bridgeid]["control"]["object"].remove_child(
                            this._compactBridgesMenu[bridgeid]["control"]["switch"]
                        );
                    }

                    if (this._compactBridgesMenu[bridgeid]["control"]["slider"] != null){
                        this._compactBridgesMenu[bridgeid]["control"]["box"].remove_child(
                            this._compactBridgesMenu[bridgeid]["control"]["slider"]
                        );
                    }

                    /**
                     * If brightness is possible, add a slider
                     */
                    let lightSlider = null;
                    if ((groupid === null &&
                            data["lights"][lightid]["state"]["bri"] !== undefined) ||
                        (groupid !== null &&
                            data["groups"][groupid]["action"]["bri"] !== undefined)) {

                        lightSlider = this._createBrightnessSlider(bridgeid, lightid, groupid, true);
                        this._compactBridgesMenu[bridgeid]["control"]["box"].add(lightSlider);
                    }

                    let lightSwitch = this._createLightSwitch(bridgeid, lightid, groupid);

                    this._compactBridgesMenu[bridgeid]["control"]["object"].add(lightSwitch);

                    this._compactBridgesMenu[bridgeid]["control"]["switch"] = lightSwitch;
                    this._compactBridgesMenu[bridgeid]["control"]["slider"] = lightSlider;

                    /**
                     * ask for async all data,
                     * which will invoke refreshMenu
                     */
                    this.hue.instances[bridgeid].getAll();
                }
            );

            light.originalActivate = light.activate;
            light.activate = (event) => {
                if (this._compactMenuRemember) {
                    this._openMenuDefault = this._compactBridgesMenu[bridgeid]["control"]["object"].menu;
                }

                this._compactBridgesMenu[bridgeid]["control"]["object"].menu.open(true);

                return light.originalActivate(event);
            }
        }

        /**
         * If brightness is possible, add a slider
         */
        if ((groupid === null &&
                data["lights"][lightid]["state"]["bri"] !== undefined) ||
            (groupid !== null &&
                data["groups"][groupid]["action"]["bri"] !== undefined)) {

            itemBox.add(this._createBrightnessSlider(bridgeid, lightid, groupid, true));
        }

        /**
         * Add switch for turning the light on/off
         */
        light.add(this._createLightSwitch(bridgeid, lightid, groupid));

        return light;
    }

    /**
     * Creates array of menu items with scenes
     * 
     * @method _createScenes
     * @private
     * @param {String} bridgeid which bridge we use here
     * @param {Object} dictionary data for the bridgeid
     * @param {Number} groupid of scenes
     * @return {Object} menuitem with scenes
     */
    _createScenes(bridgeid, data, groupid) {
        let scenes = [];
        let scene;

        for (let sceneid in data["scenes"]) {
            if (data["scenes"][sceneid]["group"] != undefined &&
                data["scenes"][sceneid]["group"] === groupid.toString()) {

                scene = new PopupMenu.PopupMenuItem(
                    data["scenes"][sceneid]["name"]
                );

                scene.x_align = Clutter.ActorAlign.FILL;
                scene.x_expand = true;
                scene.label.x_align = Clutter.ActorAlign.CENTER;
                scene.label.set_x_expand(true);

                scene.connect(
                    "button-press-event",
                    this._menuEventHandler.bind(
                        this,
                        {
                            "bridgePath": "",
                            "bridgeid": bridgeid,
                            "groupid": groupid,
                            "object":sceneid,
                            "type": "scene"
                        }
                    )
                );
                scenes.push(scene);
            }
        }

        return scenes;
    }

    /**
     * Creates array of menu item with light controls.
     * 
     * @method _createMenuLights
     * @private
     * @param {String} bridgeid which bridge we use here
     * @param {Object} dictionary data for the bridgeid
     * @param {Number} lightid of created light (not used if groupid provided)
     * @param {Number} groupid creates menu item for all lights (not mandatory)
     * @param {String} compact specifies scenes or lights (used by compact menu)
     * @return {Object} array of menuitem with light controls
     */
    _createMenuLights(bridgeid, data, lights, groupid, compact = null) {

        let lightsItems = [];
        let light;

        if (lights.length === 0) {
            return [];
        }

        if (compact !== "scenes") {

            if (compact === null) {
                /*  do not add "All" item in compcat menu */
                light = this._createItemLight(
                    bridgeid,
                    data,
                    lights,
                    groupid,
                    compact === "lights" ? true : false
                );
                lightsItems.push(light);
            }

            for (let lightid in lights) {
                light = this._createItemLight(
                    bridgeid,
                    data,
                    parseInt(lights[lightid]),
                    null,
                    compact === "lights" ? true : false
                );
                lightsItems.push(light);
            }
        }

        if (this._showScenes && compact !== "lights") {
            lightsItems = lightsItems.concat(
                this._createScenes(bridgeid, data, groupid)
            );
        }
        return lightsItems;
    }

    /**
     * Creates switch for group menu item
     * 
     * @method _createGroupSwitch
     * @param {String} bridgeid
     * @param {String} groupid
     * @param {Boolean} tmp used by compact menu for removing from refreshing objects
     * @return {Object} switch button
     */
    _createGroupSwitch(bridgeid, groupid, tmp = false) {
        let switchBox;
        let switchButton;

        let bridgePath = `${this._rndID()}::groups::${groupid}::state::any_on`;

        switchBox = new PopupMenu.Switch(false);
        switchButton = new St.Button({reactive: true, can_focus: true});
        switchButton.set_x_align(Clutter.ActorAlign.END);
        switchButton.set_x_expand(false);
        switchButton.child = switchBox;
        switchButton.connect(
            "button-press-event",
            Lang.bind(this, function() {
                switchBox.toggle();
            })
        );
        switchButton.connect(
            "button-press-event",
            this._menuEventHandler.bind(
                this,
                {
                    "bridgePath": bridgePath,
                    "bridgeid": bridgeid,
                    "object":switchBox,
                    "type": "switch"
                }
            )
        );

        this.refreshMenuObjects[bridgePath] = {
            "bridgeid": bridgeid,
            "object":switchBox,
            "type": "switch",
            "tmp": tmp
        }

        return switchButton;
    }


    /**
     * Get gnome icon by name.
     * 
     * @method _getGnomeIcon
     * @param {String} path to icon
     * @return {Object} icon or null if not found
     */
    _getGnomeIcon(iconName) {

        let icon = null;

        try {

            icon = new St.Icon({
                gicon : Gio.ThemedIcon.new(iconName),
                style_class : 'system-status-icon',
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER
            });

            icon.set_size(IconSize * 0.8, IconSize * 0.8);

            let iconEffect = this._getIconColorEffect(this._iconPack);
            icon.add_effect(iconEffect);

            iconEffect = this._getIconBriConEffect(this._iconPack);
            icon.add_effect(iconEffect);

        } catch(err) {
            return null;
        }

        return icon;
    }

    /**
     * Read icon from FS and return icon.
     * 
     * @method _getIconByPath
     * @param {String} path to icon
     * @return {Object} icon or null if not found
     */
    _getIconByPath(iconPath) {

        let icon = null;

        try {

            icon = new St.Icon({
                gicon : Gio.icon_new_for_string(iconPath),
                style_class : 'system-status-icon',
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER
            });

            icon.set_size(IconSize, IconSize);

            let iconEffect = this._getIconBriConEffect(this._iconPack);
            icon.add_effect(iconEffect);

        } catch(err) {
            return null;
        }

        return icon;
    }

    /**
     * Tries to determine icon for group from class
     * 
     * @method _tryGetGroupIcon
     * @param {Object} group data
     * @return {Object} icon or null
     */
    _tryGetGroupIcon(groupData) {

        let iconPath = "";

        if (this._iconPack === PhueIconPack.NONE) {
            return null;
        }


        if (groupData["class"] === undefined) {
            return null;
        }

        if (Utils.getHueIconFile[groupData["class"]] === undefined) {
            return null;
        }

        iconPath = Me.dir.get_path() + `/media/HueIcons/${Utils.getHueIconFile[groupData["class"]]}.svg`

        return this._getIconByPath(iconPath);
    }

    /**
     * Tries to determine icon for light
     * 
     * @method _tryGetLightIcon
     * @param {Object} group data
     * @return {Object} icon or null
     */
    _tryGetLightIcon(lightData) {

        let iconPath = "";

        if (this._iconPack === PhueIconPack.NONE) {
            return null;
        }


        if (lightData["modelid"] === undefined) {
            return null;
        }

        if (Utils.getHueIconFile[lightData["modelid"]] === undefined) {
            iconPath = Me.dir.get_path() + `/media/HueIcons/bulbsClassic.svg`
        } else {
            iconPath = Me.dir.get_path() + `/media/HueIcons/${Utils.getHueIconFile[lightData["modelid"]]}.svg`
        }

        return this._getIconByPath(iconPath);
    }

    /**
     * Tries to determine icon for accessory
     * 
     * @method _tryGetAccessoryIcon
     * @param {Object} group data
     * @return {Object} icon or null
     */
    _tryGetSensorIcon(sensorData) {

        let iconPath = "";

        if (this._iconPack === PhueIconPack.NONE) {
            return null;
        }


        if (sensorData["modelid"] === undefined) {
            return null;
        }

        if (Utils.getHueIconFile[sensorData["modelid"]] === undefined) {
            return null;
        }

        iconPath = Me.dir.get_path() + `/media/HueIcons/${Utils.getHueIconFile[sensorData["modelid"]]}.svg`

        return this._getIconByPath(iconPath);
    }

    /**
     * Using compact menu, this function will set
     * the group menu to default group 0
     * 
     * @method _setCompactMenuZeroGroup
     * @param {String} bridgeid
     */
    _setCompactMenuZeroGroup(bridgeid) {

        if (this._compactBridgesMenu[bridgeid]["groups"]["icon"] != null){
            this._compactBridgesMenu[bridgeid]["groups"]["object"].remove_child(
                this._compactBridgesMenu[bridgeid]["groups"]["icon"]
            );
        }

        if (this._compactBridgesMenu[bridgeid]["groups"]["switch"] != null){
            this._compactBridgesMenu[bridgeid]["groups"]["object"].remove_child(
                this._compactBridgesMenu[bridgeid]["groups"]["switch"]
            );
        }

        if (this._compactBridgesMenu[bridgeid]["groups"]["slider"] != null){
            this._compactBridgesMenu[bridgeid]["groups"]["box"].remove_child(
                this._compactBridgesMenu[bridgeid]["groups"]["slider"]
            );
        }

        this._compactBridgesMenu[bridgeid]["groups"]["object"].label.text = _("Rooms & Zones");
        
        let groupsIcon = null;
        if (this._iconPack !== PhueIconPack.NONE) {
            let iconPath = "";

            iconPath = Me.dir.get_path() + `/media/HueIcons/roomsOther.svg`

            groupsIcon = this._getIconByPath(iconPath);
        }

        if (groupsIcon !== null) {
            this._compactBridgesMenu[bridgeid]["groups"]["object"].insert_child_at_index(groupsIcon, 1);
        }

        let groupSlider = this._createBrightnessSlider(bridgeid, null, 0, true);
        this._compactBridgesMenu[bridgeid]["groups"]["box"].add(groupSlider);
        
        let groupSwitch = this._createGroupSwitch(bridgeid, 0, true);
        this._compactBridgesMenu[bridgeid]["groups"]["object"].add(groupSwitch);

        this._compactBridgesMenu[bridgeid]["groups"]["icon"] = groupsIcon;
        this._compactBridgesMenu[bridgeid]["groups"]["switch"] = groupSwitch;
        this._compactBridgesMenu[bridgeid]["groups"]["slider"] = groupSlider;
    }

    /**
     * Using compact menu, this function will set
     * the lights menu to default group 0
     * 
     * @method _setCompactMenuZeroLights
     * @param {String} bridgeid
     * @param {Object} data wor creating lights
     */
    _setCompactMenuZeroLights(bridgeid, data) {

        let groupid = 0;

        if (this._compactBridgesMenu[bridgeid]["lights"]["switch"] != null){
            this._compactBridgesMenu[bridgeid]["lights"]["object"].remove_child(
                this._compactBridgesMenu[bridgeid]["lights"]["switch"]
            );
        }

        if (this._compactBridgesMenu[bridgeid]["lights"]["slider"] != null){
            this._compactBridgesMenu[bridgeid]["lights"]["box"].remove_child(
                this._compactBridgesMenu[bridgeid]["lights"]["slider"]
            );
        }

        this._compactBridgesMenu[bridgeid]["lights"]["object"].label.text = _("Lights");

        let groupSwitch = this._createLightSwitch(bridgeid, null, groupid);
        this._compactBridgesMenu[bridgeid]["lights"]["object"].add(groupSwitch);

        this._compactBridgesMenu[bridgeid]["lights"]["object"].menu.removeAll();

        let lightItems = this._createMenuLights(
            bridgeid,
            data,
            data["groups"][groupid]["lights"],
            groupid,
            "lights"
        );

        for (let lightItem in lightItems) {
            this._compactBridgesMenu[bridgeid]["lights"]["object"].menu.addMenuItem(
                lightItems[lightItem]
            );
        }

        this._compactBridgesMenu[bridgeid]["lights"]["switch"] = groupSwitch;
    }

    /**
     * Using compact menu, this function will set
     * the control menu to desired group.
     * 
     * @method _setCompactMenuGroupControl
     * @param {String} bridgeid
     * @param {Number} groupid
     */
    _setCompactMenuGroupControl(bridgeid, groupid) {

        if (this._compactBridgesMenu[bridgeid]["control"]["switch"] != null){
            this._compactBridgesMenu[bridgeid]["control"]["object"].remove_child(
                this._compactBridgesMenu[bridgeid]["control"]["switch"]
            );
        }

        if (this._compactBridgesMenu[bridgeid]["control"]["slider"] != null){
            this._compactBridgesMenu[bridgeid]["control"]["box"].remove_child(
                this._compactBridgesMenu[bridgeid]["control"]["slider"]
            );
        }

        this._compactBridgesMenu[bridgeid]["control"]["object"].menu.removeAll();

        this._compactBridgesMenu[bridgeid]["control"]["object"].label.text = _("Control");

        let controlItem = new PopupMenu.PopupMenuItem(
            _("None")
        )

        controlItem.remove_child(controlItem.label);

        let colorPickerBox = new ColorPicker.ColorPickerBox();
        controlItem.add(colorPickerBox.createColorBox());

        let bridgePath = `${this._rndID()}::groups::${groupid}::action::hue`;

        this.colorPicker = colorPickerBox;

        let dataColor = {
            "bridgeid": bridgeid,
            "bridgePath": bridgePath,
            "type": "set-color"
        }

        colorPickerBox.connect(
            "color-picked",
                this._menuEventHandler.bind(this, dataColor)
        );

        let dataBrightness = {
            "bridgeid": bridgeid,
            "bridgePath": bridgePath,
            "type": "brightness-colorpicker"
        }

        colorPickerBox.connect(
            "brightness-picked",
            this._menuEventHandler.bind(this, dataBrightness)
        );

        this._compactBridgesMenu[bridgeid]["control"]["object"].menu.addMenuItem(controlItem);
    }

    /**
     * Using compact menu, this function will set
     * the control menu to the group 0.
     * 
     * @method _setCompactMenuZeroControl
     * @param {String} bridgeid
     */
    _setCompactMenuZeroControl(bridgeid) {
        this._setCompactMenuGroupControl(bridgeid, 0);
    }

    /**
     * Creates zero item - 'back to Rooms and zones' button
     * 
     * @method _compactMenuCreateZeroItem
     * @param {String} bridgeid
     */
    _compactMenuCreateZeroItem(bridgeid) {

        let zeroItem = new PopupMenu.PopupMenuItem(
            _("Rooms & Zones")
        );

        let label = zeroItem.label
        zeroItem.remove_child(zeroItem.label);
        let itemBox = new St.BoxLayout();
        itemBox.vertical = true;
        itemBox.add(label);
        zeroItem.insert_child_at_index(itemBox, 1);

        let groupsIcon = null;
        if (this._iconPack !== PhueIconPack.NONE) {
            let iconPath = "";

            iconPath = Me.dir.get_path() + `/media/HueIcons/roomsOther.svg`

            groupsIcon = this._getIconByPath(iconPath);
        }

        if (groupsIcon !== null) {
            zeroItem.insert_child_at_index(groupsIcon, 1);
        }

        itemBox.add(this._createBrightnessSlider(bridgeid, null, 0, false));
        zeroItem.add(this._createGroupSwitch(bridgeid, 0, false));

        zeroItem.x_align = Clutter.ActorAlign.FILL;
        zeroItem.x_expand = true;
        zeroItem.label.set_x_expand(true);

        zeroItem.connect (
            'button-press-event',
            () => {
                this._compactMenuClearTmpObjects(bridgeid);

                this._setCompactMenuZeroGroup(bridgeid);
                this._setCompactMenuZeroLights(bridgeid, this.bridesData[bridgeid]);
                this._setCompactMenuZeroControl(bridgeid);

                /**
                 * ask for async all data,
                 * which will invoke refreshMenu
                 */
                this.hue.instances[bridgeid].getAll();
            }
        );

        zeroItem.originalActivate = zeroItem.activate;
        zeroItem.activate = (event) => {
            if (this._compactMenuRemember) {
                this._openMenuDefault = this._compactBridgesMenu[bridgeid]["groups"]["object"].menu;
            }

            this._compactBridgesMenu[bridgeid]["lights"]["object"].menu.open(true);

            this._compactBridgesMenu[bridgeid]["hidden-item"].visible = true;

            zeroItem.visible = false;
            this._compactBridgesMenu[bridgeid]["hidden-item"] = zeroItem;

            this._compactBridgesMenu[bridgeid]["scenes"]["object"].visible = false;

            return zeroItem.originalActivate(event);
        }

        zeroItem.visible = false;
        this._compactBridgesMenu[bridgeid]["hidden-item"] = zeroItem;

        return zeroItem;
    }

    /**
     * Clear tmp items in refresh list.
     * So destroyed items will not be attempted
     * to be refreshed.
     * 
     * @method _compactMenuClearTmpObjects
     * @param {String} bridgeid
     */
    _compactMenuClearTmpObjects(bridgeid) {
        /* remove previously created object from refreshing */
        for (let i in this.refreshMenuObjects) {
            if (this.refreshMenuObjects[i]["tmp"] &&
                this.refreshMenuObjects[i]["bridgeid"] === bridgeid) {

                delete (this.refreshMenuObjects[i]);
            }
        }
    }

    /**
     * Creates items of groups for compact menu,
     * also adds callbe for such a item. In this
     * callback the top-menu item is modified
     * 
     * @method _createCompactGroups
     * @param {String} bridgeid
     * @param {Object} data
     * @param {String} groupType
     * @return {Object} items of menu
     */
    _createCompactGroups(bridgeid, data, groupType) {

        let menuItems = [];
        let groupIcon = null;

        if (data["groups"] === undefined) {
            return [];
        }

        for (let groupid in data["groups"]) {
            if (data["groups"][groupid]["type"] !== groupType) {
                continue;
            }

            let groupItem = new PopupMenu.PopupMenuItem(
                data["groups"][groupid]["name"]
            );

            let label = groupItem.label
            groupItem.remove_child(groupItem.label);
            let itemBox = new St.BoxLayout();
            itemBox.vertical = true;
            itemBox.add(label);
            itemBox.add(this._createBrightnessSlider(bridgeid, null, groupid));
            groupItem.insert_child_at_index(itemBox, 1);

            groupIcon = this._tryGetGroupIcon(data["groups"][groupid]);
            if (groupIcon !== null) {
                groupItem.insert_child_at_index(groupIcon, 1);
            }

            groupItem.set_x_align(Clutter.ActorAlign.FILL);
            groupItem.label.set_x_expand(true);

            groupItem.add(this._createGroupSwitch(bridgeid, groupid));

            groupItem.connect(
                'button-press-event',
                () => {
                    this._compactBridgesMenu[bridgeid]["selected-group"] = groupid;

                    this._compactMenuClearTmpObjects(bridgeid);

                    if (this._compactBridgesMenu[bridgeid]["groups"]["icon"] != null){
                        this._compactBridgesMenu[bridgeid]["groups"]["object"].remove_child(
                            this._compactBridgesMenu[bridgeid]["groups"]["icon"]
                        );
                    }

                    if (this._compactBridgesMenu[bridgeid]["groups"]["switch"] != null){
                        this._compactBridgesMenu[bridgeid]["groups"]["object"].remove_child(
                            this._compactBridgesMenu[bridgeid]["groups"]["switch"]
                        );
                    }

                    if (this._compactBridgesMenu[bridgeid]["groups"]["slider"] != null){
                        this._compactBridgesMenu[bridgeid]["groups"]["box"].remove_child(
                            this._compactBridgesMenu[bridgeid]["groups"]["slider"]
                        );
                    }

                    let groupSlider = this._createBrightnessSlider(bridgeid, null, groupid, true);
                    this._compactBridgesMenu[bridgeid]["groups"]["box"].insert_child_at_index(groupSlider, 1);
                    this._compactBridgesMenu[bridgeid]["groups"]["slider"] = groupSlider;

                    groupIcon = this._tryGetGroupIcon(data["groups"][groupid]);

                    if (groupIcon !== null) {
                        this._compactBridgesMenu[bridgeid]["groups"]["object"].insert_child_at_index(groupIcon, 1);
                        this._compactBridgesMenu[bridgeid]["groups"]["icon"] = groupIcon;
                    }

                    this._compactBridgesMenu[bridgeid]["groups"]["object"].label.text = data["groups"][groupid]["name"];

                    let groupSwitch = this._createGroupSwitch(bridgeid, groupid, true);
                    this._compactBridgesMenu[bridgeid]["groups"]["object"].add(groupSwitch);
                    this._compactBridgesMenu[bridgeid]["groups"]["switch"] = groupSwitch;

                    /* lights */
                    this._compactBridgesMenu[bridgeid]["lights"]["object"].label.text = _("Lights");

                    if (this._compactBridgesMenu[bridgeid]["lights"]["switch"] != null){
                        this._compactBridgesMenu[bridgeid]["lights"]["object"].remove_child(
                            this._compactBridgesMenu[bridgeid]["lights"]["switch"]
                        );
                    }

                    groupSwitch = this._createLightSwitch(bridgeid, null, groupid);
                    this._compactBridgesMenu[bridgeid]["lights"]["object"].add(groupSwitch);
                    this._compactBridgesMenu[bridgeid]["lights"]["switch"] = groupSwitch;

                    this._compactBridgesMenu[bridgeid]["lights"]["object"].menu.removeAll();

                    let lightItems = this._createMenuLights(
                        bridgeid,
                        data,
                        data["groups"][groupid]["lights"],
                        groupid,
                        "lights"
                    );
                    for (let lightItem in lightItems) {
                        this._compactBridgesMenu[bridgeid]["lights"]["object"].menu.addMenuItem(lightItems[lightItem]);
                    }

                    /* scenes */
                    if (this._showScenes && this._compactBridgesMenu[bridgeid]["scenes"] !== undefined) {
                        this._compactBridgesMenu[bridgeid]["scenes"]["object"].menu.removeAll();

                        this._compactBridgesMenu[bridgeid]["scenes"]["object"].visible = true;

                        let scenesItems = this._createMenuLights(
                            bridgeid,
                            data,
                            data["groups"][groupid]["lights"],
                            groupid,
                            "scenes"
                        );
                        for (let sceneItem in scenesItems) {
                            this._compactBridgesMenu[bridgeid]["scenes"]["object"].menu.addMenuItem(scenesItems[sceneItem]);
                        }
                    }

                    /* control */
                    this._setCompactMenuGroupControl(bridgeid, groupid);

                    /**
                     * ask for async all data,
                     * which will invoke refreshMenu
                     */
                    this.hue.instances[bridgeid].getAll();
                }
            );

            groupItem.originalActivate = groupItem.activate;
            groupItem.activate = (event) => {
                if (this._compactMenuRemember) {
                    this._openMenuDefault = this._compactBridgesMenu[bridgeid]["lights"]["object"].menu;
                }

                this._compactBridgesMenu[bridgeid]["lights"]["object"].menu.open(true);

                this._compactBridgesMenu[bridgeid]["hidden-item"].visible = true;

                groupItem.visible = false;
                this._compactBridgesMenu[bridgeid]["hidden-item"] = groupItem;

                return groupItem.originalActivate(event);
            }

            menuItems.push(groupItem);
        }

        return menuItems;
    }

    /**
     * Creates groups (rooms/zones) menu
     * for compact menu
     * 
     * @method _createCompactMenuGroups
     * @param {String} bridgeid
     * @param {Object} data
     * @return {Object} menu items
     */
    _createCompactMenuGroups(bridgeid, data) {
        let menuItems = [];
        let items = [];

        if (this._compactBridgesMenu === undefined) {
            this._compactBridgesMenu = {};
        }

        this._compactBridgesMenu[bridgeid] = {};

        let groupsSubMenu = new PopupMenu.PopupSubMenuMenuItem(
            _("Rooms & Zones")
        );

        /* disable closing menu on item activated */
        groupsSubMenu.menu.itemActivated = (animate) => {};

        let label = groupsSubMenu.label
        groupsSubMenu.remove_child(groupsSubMenu.label);
        let itemBox = new St.BoxLayout();
        itemBox.vertical = true;
        itemBox.add(label);
        groupsSubMenu.insert_child_at_index(itemBox, 1);

        let groupsIcon = null;
        if (this._iconPack !== PhueIconPack.NONE) {
            let iconPath = "";

            iconPath = Me.dir.get_path() + `/media/HueIcons/roomsOther.svg`

            groupsIcon = this._getIconByPath(iconPath);
        }

        if (groupsIcon !== null) {
            groupsSubMenu.insert_child_at_index(groupsIcon, 1);
        }

        this._compactBridgesMenu[bridgeid]["groups"] = {}
        this._compactBridgesMenu[bridgeid]["groups"]["object"] = groupsSubMenu;
        this._compactBridgesMenu[bridgeid]["groups"]["icon"] = groupsIcon;
        this._compactBridgesMenu[bridgeid]["groups"]["box"] = itemBox;
        this._compactBridgesMenu[bridgeid]["groups"]["switch"] = null;
        this._compactBridgesMenu[bridgeid]["groups"]["slider"] = null;
        this._compactBridgesMenu[bridgeid]["selected-group"] = null;
        this._compactBridgesMenu[bridgeid]["selected-light"] = null;

        this._setCompactMenuZeroGroup(bridgeid);

        this._openMenuDefault = groupsSubMenu.menu;

        groupsSubMenu.connect(
            'button-press-event',
            () => {
                if (!this._compactMenuRemember) {
                    this._openMenuDefault = this._compactBridgesMenu[bridgeid]["groups"]["object"].menu;
                    return;
                }

                this._openMenuDefault = null;
                if (!groupsSubMenu.menu.isOpen) {
                    this._openMenuDefault = groupsSubMenu.menu;
                }
            }
        );

        menuItems.push(groupsSubMenu);

        groupsSubMenu.menu.addMenuItem(
            this._compactMenuCreateZeroItem(bridgeid)
        );

        groupsSubMenu.menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem()
        );

        if (this._zonesFirst) {
            items = items.concat(
                this._createCompactGroups(bridgeid, data, "Zone")
            );

            if (items.length > 0) {
                items = items.concat(
                    [new PopupMenu.PopupSeparatorMenuItem()]
                );
            }

            items = items.concat(
                this._createCompactGroups(bridgeid, data, "Room")
            );
        } else {
            items = items.concat(
                this._createCompactGroups(bridgeid, data, "Room")
            );

            if (items.length > 0) {
                items = items.concat(
                    [new PopupMenu.PopupSeparatorMenuItem()]
                );
            }

            items = items.concat(
                this._createCompactGroups(bridgeid, data, "Zone")
            );
        }

        for (let i in items) {
            groupsSubMenu.menu.addMenuItem(items[i]);
        }

        this._openMenuDefault = this._compactBridgesMenu[bridgeid]["groups"]["object"].menu;

        return menuItems;
    }

    /**
     * Creates lights menu for compact menu
     * based on item selected in group menu.
     * 
     * @method _createCompactMenuLights
     * @param {String} bridgeid
     * @param {Object} data
     * @return {Object} menu items
     */
    _createCompactMenuLights(bridgeid, data) {
        let lightsSubMenu = new PopupMenu.PopupSubMenuMenuItem(
            _("Lights")
        );

        /* disable closing menu on item activated */
        lightsSubMenu.menu.itemActivated = (animate) => {};

        let label = lightsSubMenu.label
        lightsSubMenu.remove_child(lightsSubMenu.label);
        let itemBox = new St.BoxLayout();
        itemBox.vertical = true;
        itemBox.add(label);
        lightsSubMenu.insert_child_at_index(itemBox, 1);

        lightsSubMenu.connect(
            'button-press-event',
            () => {
                if (this._compactBridgesMenu[bridgeid]["selected-group"] !== null) {
                    this._setCompactMenuGroupControl(
                        bridgeid,
                        this._compactBridgesMenu[bridgeid]["selected-group"]
                    );
                }

                if (!this._compactMenuRemember) {
                    this._openMenuDefault = this._compactBridgesMenu[bridgeid]["groups"]["object"].menu;
                    return;
                }

                this._openMenuDefault = null;
                if (!lightsSubMenu.menu.isOpen) {
                    this._openMenuDefault = lightsSubMenu.menu;
                }
            }
        );

        let lightsIcon = null;
        if (this._iconPack !== PhueIconPack.NONE) {
            lightsIcon = this._getIconByPath(
                Me.dir.get_path() + `/media/HueIcons/bulbGroup.svg`
            );
        }

        if (lightsIcon !== null) {
            lightsSubMenu.insert_child_at_index(lightsIcon, 1);
        }

        this._compactBridgesMenu[bridgeid]["lights"] = {};
        this._compactBridgesMenu[bridgeid]["lights"]["object"] = lightsSubMenu;
        this._compactBridgesMenu[bridgeid]["lights"]["icon"] = lightsIcon;
        this._compactBridgesMenu[bridgeid]["lights"]["box"] = itemBox;
        this._compactBridgesMenu[bridgeid]["lights"]["switch"] = null;
        this._compactBridgesMenu[bridgeid]["lights"]["slider"] = null;

        this._setCompactMenuZeroLights(bridgeid, data);

        return lightsSubMenu;
    }

    /**
     * Creates scenes menu for compact menu
     * based on item selected in group menu.
     * 
     * @method _createCompactMenuScenes
     * @param {String} bridgeid
     * @param {Object} data
     * @return {Object} menu items
     */
    _createCompactMenuScenes(bridgeid, data) {
        let scenesSubMenu = new PopupMenu.PopupSubMenuMenuItem(
            _("Scenes")
        );

        /* disable closing menu on item activated */
        scenesSubMenu.menu.itemActivated = (animate) => {};

        scenesSubMenu.connect(
            'button-press-event',
            () => {
                if (!this._compactMenuRemember) {
                    this._openMenuDefault = this._compactBridgesMenu[bridgeid]["groups"]["object"].menu;
                    return;
                }

                this._openMenuDefault = null;
                if (!scenesSubMenu.menu.isOpen) {
                    this._openMenuDefault = scenesSubMenu.menu;
                }
            }
        );

        let scenesIcon = null;
        if (this._iconPack !== PhueIconPack.NONE) {
            let iconPath = "";

            iconPath = Me.dir.get_path() + `/media/HueIcons/uicontrolsScenes.svg`

            scenesIcon = this._getIconByPath(iconPath);
        }

        if (scenesIcon !== null) {
            scenesSubMenu.insert_child_at_index(scenesIcon, 1);
        }

        this._compactBridgesMenu[bridgeid]["scenes"] = {};
        this._compactBridgesMenu[bridgeid]["scenes"]["object"] = scenesSubMenu;
        this._compactBridgesMenu[bridgeid]["scenes"]["icon"] = scenesIcon;

        if (this._compactBridgesMenu[bridgeid]["selected-group"] === null) {

            scenesSubMenu.menu.addMenuItem(
                new PopupMenu.PopupMenuItem(
                    _("No room/zone selected")
                )
            );

            scenesSubMenu.visible = false;

            return scenesSubMenu;
        }

        let groupid = this._compactBridgesMenu[bridgeid]["selected-group"];

        let lightItems = this._createMenuLights(
            bridgeid,
            data,
            data["groups"][groupid]["lights"],
            groupid,
            "scenes"
        );
        for (let lightItem in lightItems) {
            scenesSubMenu.menu.addMenuItem(lightItems[lightItem]);
        }

        return scenesSubMenu;
    }

    _createCompactMenuControl(bridgeid, data) {
        let controlSubMenu = new PopupMenu.PopupSubMenuMenuItem(
            _("Control")
        );

        let label = controlSubMenu.label
        controlSubMenu.remove_child(controlSubMenu.label);
        let itemBox = new St.BoxLayout();
        itemBox.vertical = true;
        itemBox.add(label);
        controlSubMenu.insert_child_at_index(itemBox, 1);

        /* disable closing menu on item activated */
        controlSubMenu.menu.itemActivated = (animate) => {};

        controlSubMenu.connect(
            'button-press-event',
            () => {
                if (!this._compactMenuRemember) {
                    this._openMenuDefault = this._compactBridgesMenu[bridgeid]["groups"]["object"].menu;
                    return;
                }

                this._openMenuDefault = null;
                if (!controlSubMenu.menu.isOpen) {
                    this._openMenuDefault = controlSubMenu.menu;
                }
            }
        );

        let controlIcon = null;
        if (this._iconPack !== PhueIconPack.NONE) {
            let iconPath = "";

            iconPath = Me.dir.get_path() + `/media/HueIcons/uicontrolsColorScenes.svg`

            controlIcon = this._getIconByPath(iconPath);
        }

        if (controlIcon !== null) {
            controlSubMenu.insert_child_at_index(controlIcon, 1);
        }

        this._compactBridgesMenu[bridgeid]["control"] = {};
        this._compactBridgesMenu[bridgeid]["control"]["object"] = controlSubMenu;
        this._compactBridgesMenu[bridgeid]["control"]["icon"] = controlIcon;
        this._compactBridgesMenu[bridgeid]["control"]["box"] = itemBox;
        this._compactBridgesMenu[bridgeid]["control"]["switch"] = null;
        this._compactBridgesMenu[bridgeid]["control"]["slider"] = null;

        this._setCompactMenuZeroControl(bridgeid);

        return controlSubMenu;
    }

    /**
     * Creates array of submenus for groups of bridge.
     * 
     * @method _createMenuGroups
     * @private
     * @param {String} bridgeid which bridge we use here
     * @param {Object} dictionary data for the bridgeid
     * @param {String} "Zone" or "Room"
     * @return {Object} array of submenus
     */
    _createMenuGroups(bridgeid, data, groupType) {

        let groupItem;
        let menuItems = [];
        let groupIcon = null;

        if (data["groups"] === undefined) {
            return [];
        }

        for (let groupid in data["groups"]) {
            if (data["groups"][groupid]["type"] !== groupType) {
                continue;
            }

            groupItem = new PopupMenu.PopupSubMenuMenuItem(
                data["groups"][groupid]["name"]
            );

            /* disable closing menu on item activated */
            groupItem.menu.itemActivated = (animate) => {};

            groupIcon = this._tryGetGroupIcon(data["groups"][groupid]);
            if (groupIcon !== null) {
                groupItem.insert_child_at_index(groupIcon, 1);
            }

            groupItem.add(this._createGroupSwitch(bridgeid, groupid));

            menuItems.push(groupItem);

            let lightItems = this._createMenuLights(
                bridgeid,
                data,
                data["groups"][groupid]["lights"],
                groupid
            );
            for (let lightItem in lightItems) {
                groupItem.menu.addMenuItem(lightItems[lightItem]);
            }
        }

        return menuItems;
    }

    /**
     * Creates switch for entertainment item
     * 
     * @method _createEntertainmentSwitch
     * @param {String} bridgeid 
     * @param {String} groupid 
     * @return {Object} switch button
     */
    _createEntertainmentSwitch(bridgeid, groupid) {
        let switchBox;
        let switchButton;

        let bridgePath = `${this._rndID()}::groups::${groupid}::stream::active`;

        switchBox = new PopupMenu.Switch(false);
        switchButton = new St.Button({reactive: true, can_focus: true});
        switchButton.set_x_align(Clutter.ActorAlign.END);
        switchButton.set_x_expand(false);
        switchButton.child = switchBox;
        switchButton.connect(
            "button-press-event",
            Lang.bind(this, function() {
                switchBox.toggle();
            })
        );
        switchButton.connect(
            "button-press-event",
            this._menuEventHandler.bind(
                this,
                {
                    "bridgePath": bridgePath,
                    "bridgeid": bridgeid,
                    "object":switchBox,
                    "type": "switchEntertainment"
                }
            )
        );

        this.refreshMenuObjects[bridgePath] = {
            "bridgeid": bridgeid,
            "object":switchBox,
            "type": "switch",
            "tmp": false
        }

        return switchButton;
    }

    /**
     * Creates entertainment item
     * 
     * @method _createItemEntertainment
     * @private
     * @param {String} bridgeid which bridge we use here
     * @param {Object} dictionary data for the bridgeid
     * @param {Number} groupid of the entertainment group
     * @return {Object} menuitem with group controls
     */
    _createItemEntertainment(bridgeid, data, groupid) {
        let entertainment;

        entertainment = new PopupMenu.PopupMenuItem(
            data["groups"][groupid]["name"]
        );

        entertainment.set_x_align(Clutter.ActorAlign.FILL);
        entertainment.label.set_x_expand(true);

        entertainment.add(this._createEntertainmentSwitch(bridgeid, groupid));

        return entertainment;
    }

    /**
     * Creates item with slider used by entertainment settings
     * 
     * @method _createEntertainmentSliderItem
     * @private
     * @param {String} bridgeid which bridge we use here
     * @param {String} name used with the item
     * @param {Number} default value
     * @return {Object} menuitem with group controls
     */
    _createEntertainmentSliderItem(bridgeid, name, defaultValue) {
        let entertainmentSliderItem;
        let bridgePath = `${this._rndID()}`;

        entertainmentSliderItem = new PopupMenu.PopupMenuItem(
            name
        );

        entertainmentSliderItem.set_x_align(Clutter.ActorAlign.FILL);
        entertainmentSliderItem.label.set_x_expand(true);

        let slider = new Slider.Slider(0);

        slider.set_width(200);
        slider.set_x_align(Clutter.ActorAlign.END);
        slider.set_x_expand(false);
        slider.value = defaultValue;

        entertainmentSliderItem.add(slider);

        slider.connect(
            "drag-end",
            this._menuEventHandler.bind(
                this,
                {
                    "bridgePath": bridgePath,
                    "bridgeid": bridgeid,
                    "object":slider,
                    "type": "entertainment" + name
                }
            )
        );

        return entertainmentSliderItem;
    }

    /**
     * Creates item with possible entertainment effects
     * 
     * @method _createsEntertainmentServiceItem
     * @private
     * @param {String} bridgeid which bridge we use here
     * @return {Object} menuitem with slider to chaneg the mode
     */
    _createsEntertainmentServiceItem(bridgeid) {
        let bridgePath = `${this._rndID()}`;
        let entertainmentServiceItem = new PopupMenu.PopupMenuItem(_("Mode"));

        entertainmentServiceItem.set_x_align(Clutter.ActorAlign.FILL);
        entertainmentServiceItem.label.set_x_expand(false);

        let slider = new Slider.Slider(0);
        slider.set_width(150);
        slider.set_x_align(Clutter.ActorAlign.END);
        slider.set_x_expand(false);

        switch (this._isStreaming[bridgeid]["entertainmentMode"]) {
            case Utils.entertainmentMode.SYNC:
                slider.value = 0;
                break;
            case Utils.entertainmentMode.CURSOR:
                slider.value = 0.5;
                break;
            case Utils.entertainmentMode.RANDOM:
                slider.value = 1;
                break;
            default:
                slider.value = 0;
        }

        let label = new St.Label({
            text: Utils.entertainmentModeText[this._isStreaming[bridgeid]["entertainmentMode"]]
        });
        label.set_x_expand(true);

        slider.connect(
            "drag-end",
            this._menuEventHandler.bind(
                this,
                {
                    "bridgePath": bridgePath,
                    "bridgeid": bridgeid,
                    "object":slider,
                    "objectLabel":label,
                    "type": "entertainmentMode"
                }
            )
        );

        entertainmentServiceItem.add(slider);

        entertainmentServiceItem.add(label);

        return entertainmentServiceItem;
    }

    /**
     * Creates entertainment menu
     * 
     * @method _createEntertainment
     * @private
     * @param {String} bridgeid which bridge we use here
     * @param {Object} dictionary data for the bridgeid
     * @return {Object} menuitem with group controls
     */
    _createEntertainment(bridgeid, data) {

        let entertainmentMainItem;
        let entertainmentIcon = null;
        let itemCounter = 0;

        if (data["groups"] === undefined) {
            return [];
        }

        entertainmentMainItem = new PopupMenu.PopupSubMenuMenuItem(
            _("Entertainment areas")
        );

        this.refreshMenuObjects[`special::${bridgeid}::entertainment-label`] = {
            "bridgeid": bridgeid,
            "object": entertainmentMainItem.label,
            "type": "entertainment-label",
            "tmp": false
        }

        if (this._iconPack !== PhueIconPack.NONE) {
            let iconPath = "";

            iconPath = Me.dir.get_path() + `/media/HueIcons/roomsMancave.svg`

            entertainmentIcon = this._getIconByPath(iconPath);
        }

        if (entertainmentIcon !== null) {
            entertainmentMainItem.insert_child_at_index(entertainmentIcon, 1);
        }

        let entertainmentIntensityItem = this._createEntertainmentSliderItem(
            bridgeid,
            "Intensity",
            ((254 - this._isStreaming[bridgeid]["intensity"] - 40)) / 100
        );
        entertainmentMainItem.menu.addMenuItem(entertainmentIntensityItem);

        let entertainmentBrightnessItem = this._createEntertainmentSliderItem(
            bridgeid,
            "Brightness",
            this._isStreaming[bridgeid]["brightness"] / 254
        );
        entertainmentMainItem.menu.addMenuItem(entertainmentBrightnessItem);

        let entertainmentServiceItem = this._createsEntertainmentServiceItem(bridgeid);
        entertainmentMainItem.menu.addMenuItem(entertainmentServiceItem);

        entertainmentMainItem.menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem()
        );

        for (let groupid in data["groups"]) {

            if (data["groups"][groupid]["type"] !== "Entertainment") {
                continue;
            }

            let entertainmentItem = this._createItemEntertainment(
                bridgeid,
                data,
                groupid
            );

            entertainmentMainItem.menu.addMenuItem(entertainmentItem);

            itemCounter++;
        }

        if (itemCounter === 0) {
            entertainmentMainItem = [];
        }

        return entertainmentMainItem;
    }

    /**
     * Creates array of submenus of compact menu for bridge.
     * 
     * @method _createCompactMenuBridge
     * @private
     * @param {String} bridgeid which bridge we use here
     * @return {Object} array of bridge label and submenus of the bridge
     */
    _createCompactMenuBridge(bridgeid) {
        let items = [];
        let data = {};

        data = this.bridesData[bridgeid];

        if (data["config"] === undefined) {
            return [];
        }

        items.push(this._createSubMenuBridge(bridgeid, data));

        items = items.concat(
            this._createEntertainment(bridgeid, data)
        );

        items = items.concat(
            this._createCompactMenuGroups(bridgeid, data)
        );

        items = items.concat(
            this._createCompactMenuLights(bridgeid, data)
        );

        if (this._showScenes) {
            items = items.concat(
                this._createCompactMenuScenes(bridgeid, data)
            );
        }

        items = items.concat(
            this._createCompactMenuControl(bridgeid, data)
        );

        return items;
    }

    /**
     * Creates array of submenus for bridge.
     * 
     * @method _createMenuBridge
     * @private
     * @param {String} bridgeid which bridge we use here
     * @return {Object} array of bridge label and submenus of the bridge
     */
    _createMenuBridge(bridgeid) {

        let items = [];
        let data = {};

        data = this.bridesData[bridgeid];

        if (data["config"] === undefined) {
            return [];
        }

        items.push(this._createSubMenuBridge(bridgeid, data));

        items = items.concat(
            this._createEntertainment(bridgeid, data)
        );

        if (this._zonesFirst) {
            items = items.concat(
                this._createMenuGroups(bridgeid, data, "Zone")
            );
            items = items.concat(
                this._createMenuGroups(bridgeid, data, "Room")
            );
        } else {
            items = items.concat(
                this._createMenuGroups(bridgeid, data, "Room")
            );
            items = items.concat(
                this._createMenuGroups(bridgeid, data, "Zone")
            );
        }

        return items;
    }

    /**
     * Check if light related to the brightness is off.
     * Thus the brightness should be off.
     * @method _checkLightOfBrightness
     * @private
     * @param {bridgeid} bridgeid
     * @param {Object} parsedBridgePath
     * @returns {Boolean} true for yes
     */
    _checkLightOfBrightness(bridgeid, p) {

        if (p[1] == "lights") {
            let light = this.bridesData[bridgeid]["lights"][p[2]];
            return light["state"]["on"];
        }

        if (p[1] == "groups") {
            let group = this.bridesData[bridgeid]["groups"][p[2]];
            return group["state"]["any_on"];
        }

        return true;
    }

    /**
     * Check if light belongs to an entertaiment group
     * and the group's stream is active now.
     * 
     * @method _checkEntertainmentStream
     * @private
     * @param {bridgeid} bridgeid
     * @param {Object} parsedBridgePath
     * @returns {Boolean} true for yes
     */
    _checkEntertainmentStream(bridgeid, p) {
        if (p[1] !== "lights") {
            return false;
        }

        if (this.bridesData[bridgeid]["groups"] === undefined) {
            return false;
        }

        for (let group in this.bridesData[bridgeid]["groups"]) {
            if (this.bridesData[bridgeid]["groups"][group]["type"] !== "Entertainment") {
                continue;
            }

            if (this.bridesData[bridgeid]["groups"][group]["stream"] === undefined) {
                continue;
            }

            if (! this.bridesData[bridgeid]["groups"][group]["stream"]["active"]) {
                continue;
            }

            for (let light in this.bridesData[bridgeid]["groups"][group]["lights"]) {
                if (parseInt(this.bridesData[bridgeid]["groups"][group]["lights"][light]) === parseInt(p[2])) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Starts the entertainment stream with selected effect
     * 
     * @method _startEntertainmentStream
     * @private
     * @param {bridgeid} bridgeid
     * @param {groupid} groupid
     */
    _startEntertainmentStream(bridgeid, groupid) {
        let gradient = false;
        let streamingLights = [];
        for (let i in this.bridesData[bridgeid]["groups"][groupid]["lights"]) {
            let light = this.bridesData[bridgeid]["groups"][groupid]["lights"][i];

            if (this.bridesData[bridgeid]["lights"][light]["productname"].indexOf("gradient") >= 0) {
                gradient = true;
                continue;
            }

            streamingLights.push(parseInt(light));
        }

        let streamingLightsLocations = {};
        for (let i in this.bridesData[bridgeid]["groups"][groupid]["locations"]) {
            streamingLightsLocations[parseInt(i)] = this.bridesData[bridgeid]["groups"][groupid]["locations"][i];
        }

        switch(this._isStreaming[bridgeid]["entertainmentMode"]) {

            case Utils.entertainmentMode.SYNC:
                Utils.logDebug(`Starting sync screen entertainment for bridge ${bridgeid} group ${groupid}`);

                this._isStreaming[bridgeid]["entertainment"].startSyncScreen(
                    streamingLights,
                    streamingLightsLocations,
                    gradient);
                break;

            case Utils.entertainmentMode.CURSOR:
                Utils.logDebug(`Starting track cursor entertainment for bridge ${bridgeid} group ${groupid}`);

                this._isStreaming[bridgeid]["entertainment"].startCursorColor(
                    streamingLights,
                    streamingLightsLocations,
                    gradient);
                break;

            case Utils.entertainmentMode.RANDOM:
                Utils.logDebug(`Starting random entertainment for bridge ${bridgeid} group ${groupid}`);

                this._isStreaming[bridgeid]["entertainment"].startRandom(
                    streamingLights,
                    streamingLightsLocations,
                    gradient);
                break;

            default:
        }
    }

    /**
     * Check if bridge generated the clientkey needed for
     * entertainment api. If not a message is displayed
     * 
     * @method _checkClientKey
     * @private
     * @param {bridgeid} bridgeid
     * @returns {Boolean} true for yes
     */
    _checkClientKey(bridgeid) {
        if (this.hue.bridges[bridgeid] === undefined ||
            this.hue.bridges[bridgeid]["clientkey"] === undefined) {

            Main.notify(
                _("Hue Lights - ") + this.hue.bridges[bridgeid]["name"],
                _("Please, remove Philips hue bridge and connect it again.")
            );

            Utils.logDebug("Client key not available");

            return false;
        }

        Utils.logDebug("Client key available");

        return true;
    }

    /**
     * Check if bridge has active entertainment stream
     * and if its not started, start the entertainment stream.
     * 
     * @method _checkHueLightsIsStreaming
     * @private
     * @param {bridgeid} bridgeid
     */
    _checkHueLightsIsStreaming(bridgeid) {
        let groupid;

        if (this._isStreaming[bridgeid] === undefined) {
            return;
        }

        if (!this.hue.instances[bridgeid].isConnected()) {
            Utils.logDebug(`Bridge ${bridgeid} disconnected while checking entertainment stream.`);

            this._isStreaming[bridgeid]["state"] = StreamState.STOPPED;

            if (this._isStreaming[bridgeid]["entertainment"] !== undefined) {
                delete(this._isStreaming[bridgeid]["entertainment"]);
            }

            return;
        }

        Utils.logDebug(`Bridge ${bridgeid} checking for entertainment streams: ${JSON.stringify(this._isStreaming)}`);

        switch (this._isStreaming[bridgeid]["state"]) {
            case StreamState.STOPPED:
                break;

            case StreamState.STARTING:

                if (!this._checkClientKey(bridgeid)) {
                    this._isStreaming[bridgeid]["state"] = StreamState.STOPPED;
                    return;
                }

                if (this._isStreaming[bridgeid]["entertainment"] !== undefined) {
                    return;
                }

                groupid = this._isStreaming[bridgeid]["groupid"];

                this._isStreaming[bridgeid]["entertainment"] = new HueEntertainment.PhueEntertainment(
                    {
                        ip: this.hue.bridges[bridgeid]["ip"],
                        username: this.hue.bridges[bridgeid]["username"],
                        clientkey: this.hue.bridges[bridgeid]["clientkey"]
                    }
                );

                this._isStreaming[bridgeid]["entertainment"].setIntensity(
                    this._isStreaming[bridgeid]["intensity"]
                );

                this._isStreaming[bridgeid]["entertainment"].setBrightness(
                    this._isStreaming[bridgeid]["brightness"]
                );

                this._isStreaming[bridgeid]["entertainment"].connectBridge();

                this._isStreaming[bridgeid]["entertainment"].connect("connected", () => {
                    this._startEntertainmentStream(bridgeid, groupid);
                    this._isStreaming[bridgeid]["state"] = StreamState.RUNNING;
                });

                this._isStreaming[bridgeid]["entertainment"].connect("disconnected", () => {
                    this._isStreaming[bridgeid]["state"] = StreamState.STOPPED;
                    delete(this._isStreaming[bridgeid]["entertainment"]);

                    groupid = this._isStreaming[bridgeid]["groupid"];
                    if (this.bridesData[bridgeid]["groups"][groupid] !== undefined &&
                        this.bridesData[bridgeid]["groups"][groupid]["stream"]["active"]) {

                        this.hue.instances[bridgeid].disableStream(groupid);
                    }

                });

                break;

            case StreamState.STOPPING:
                if (this._isStreaming[bridgeid]["entertainment"] !== undefined) {
                    this._isStreaming[bridgeid]["entertainment"].closeBridge();
                } else {
                    this._isStreaming[bridgeid]["state"] = StreamState.STOPPED;
                }

                break;

            case StreamState.RUNNING:
                groupid = this._isStreaming[bridgeid]["groupid"];

                if (!this.bridesData[bridgeid]["groups"][groupid]["stream"]["active"]) {
                    /* another app disabled stream */

                    this._isStreaming[bridgeid]["state"] = StreamState.STOPPED;

                    if (this._isStreaming[bridgeid]["entertainment"] !== undefined) {
                        delete(this._isStreaming[bridgeid]["entertainment"]);
                    }
                }

                break;

            case StreamState.FAILED:
                if (this._isStreaming[bridgeid]["entertainment"] !== undefined) {
                    delete(this._isStreaming[bridgeid]["entertainment"]);
                }

                groupid = this._isStreaming[bridgeid]["groupid"];

                if (this.bridesData[bridgeid]["groups"][groupid] !== undefined &&
                    this.bridesData[bridgeid]["groups"][groupid]["stream"]["active"]) {

                    this.hue.instances[bridgeid].disableStream(groupid);
                }

                this._isStreaming[bridgeid]["state"] = StreamState.STOPPED;
                break;

            default:
                break;
        }
    }

    /**
     * If change happened, the controls in menu are refreshed.
     * 
     * @method refreshMenu
     */
    refreshMenu() {

        let bridgeid = "";
        let type = "";
        let object = null;
        let parsedBridgePath = [];
        let value;

        Utils.logDebug("Refreshing menu.");

        for (let bridgePath in this.refreshMenuObjects) {

            bridgeid = this.refreshMenuObjects[bridgePath]["bridgeid"];
            object = this.refreshMenuObjects[bridgePath]["object"];
            type = this.refreshMenuObjects[bridgePath]["type"];

            if (this.bridesData[bridgeid].length === 0) {
                continue;
            }

            parsedBridgePath = bridgePath.split("::");

            switch (type) {

                case "switch":

                    parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

                    value = this.bridesData[bridgeid];
                    for (let i in parsedBridgePath) {
                        if (i == 0) {
                            continue;
                        }

                        if (value === undefined){
                            break;
                        }

                        value = value[parsedBridgePath[i]];
                    }

                    if (object.state !== value) {
                        object.state = value;
                    }

                    if (this._checkEntertainmentStream(bridgeid, parsedBridgePath)) {
                        object.state = true;
                    }

                    break;

                case "brightness":

                    parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

                    value = this.bridesData[bridgeid];
                    for (let i in parsedBridgePath) {
                        if (i == 0) {
                            continue;
                        }

                        value = value[parsedBridgePath[i]];
                    }

                    if (parsedBridgePath[1] === "groups") {
                        value = this._getGroupBrightness(bridgeid, parsedBridgePath[2]);
                    }

                    value = value/255;

                    if (!this._checkLightOfBrightness(bridgeid, parsedBridgePath)) {
                        value = 0;
                    }

                    if (object.value !== value) {
                        object.value = value;
                    }

                    object.visible = true;
                    if (this._checkEntertainmentStream(bridgeid, parsedBridgePath)) {
                        object.visible = false;
                        object.value = 0;
                    }

                    break;

                case "slider-color":
                    parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

                    value = this.bridesData[bridgeid];
                    for (let i in parsedBridgePath) {
                        if (i == 0) {
                            continue;
                        }

                        value = value[parsedBridgePath[i]];
                    }

                    if (parsedBridgePath[1] === "lights" &&  !value["on"] ||
                        (parsedBridgePath[1] === "groups" && this._getGroupBrightness(bridgeid, parsedBridgePath[2]) === 0)) {

                        object.style = null;

                        break;
                    }

                    let r = 0;
                    let g = 0;
                    let b = 0;

                    if (parsedBridgePath[1] === "lights") {
                        [r, g, b] = Utils.xyBriToColor(
                            value["xy"][0],
                            value["xy"][1],
                            255 /* or value["bri"] */
                        );
                    }

                    if (parsedBridgePath[1] === "groups") {
                        [r, g, b] = this._getGroupColor(bridgeid, parsedBridgePath[2]);
                    }

                    r = ('0' + r.toString(16)).slice(-2);
                    g = ('0' + g.toString(16)).slice(-2);
                    b = ('0' + b.toString(16)).slice(-2);

                    let styleColor = `#${r}${g}${b}`;

                    object.style = `-barlevel-active-background-color: ${styleColor}; -barlevel-active-border-color: ${styleColor}`;

                    break;

                case "battery":

                    parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

                    value = this.bridesData[bridgeid];
                    for (let i in parsedBridgePath) {
                        if (i == 0) {
                            continue;
                        }

                        value = value[parsedBridgePath[i]];
                    }

                    value = `${value}%`;

                    if (object.text !== value) {
                        object.text = value;
                    }

                    break;

                case "temperature":

                    parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

                    value = this.bridesData[bridgeid];
                    for (let i in parsedBridgePath) {
                        if (i == 0) {
                            continue;
                        }

                        value = value[parsedBridgePath[i]];
                    }

                    value = value/100;

                    value = `${Math.round(value)}°C/${Math.round(value * 1.8 + 32)}°F`;

                    if (object.text !== value) {
                        object.text = value;
                    }

                    break;

                case "light-level":

                    parsedBridgePath[2] = parseInt(parsedBridgePath[2]);

                    value = this.bridesData[bridgeid];
                    for (let i in parsedBridgePath) {
                        if (i == 0) {
                            continue;
                        }

                        value = value[parsedBridgePath[i]];
                    }

                    value = Math.round(Math.pow(10, (value - 1) / 10000));

                    value = `${value} lux`;

                    if (object.text !== value) {
                        object.text = value;
                    }

                    break;

                case "entertainment-label":

                    object.text = _("Entertainment areas");

                    if (this.bridesData[bridgeid]["groups"] === undefined) {
                        break;
                    }

                    for (let groupid in this.bridesData[bridgeid]["groups"]) {
                        if (this.bridesData[bridgeid]["groups"][groupid]["type"] !== "Entertainment") {
                            continue;
                        }

                        if (this.bridesData[bridgeid]["groups"][groupid]["stream"]["active"]) {
                            object.text = `${this.bridesData[bridgeid]["groups"][groupid]["name"]} ` + _("is syncing");
                        }
                    }

                    break;

                default:
            }
        }
    }

    /**
     * Connect signals from bridge instance.
     * The signals handles async data events.
     * 
     * @method _connectHueInstance
     * @param {String} bridgeid
     */
    _connectHueInstance(bridgeid) {

        this.hue.instances[bridgeid].connect(
            "change-occurred",
            () => {
                /* ask for async all data,
                 * which will invoke refreshMenu*/
                this.hue.instances[bridgeid].getAll();
            }
        );

        this.hue.instances[bridgeid].connect(
            "all-data",
            () => {
                if (this.hue.instances[bridgeid].isConnected()) {
                    this.bridesData[bridgeid] = this.hue.instances[bridgeid].getAsyncData();
                }

                if (this.bridgeInProblem[bridgeid] !== undefined &&
                    this.bridgeInProblem[bridgeid]) {
                        Main.notify(
                            _("Hue Lights - ") + this.hue.bridges[bridgeid]["name"],
                            _("Connection to Philips Hue bridge restored")
                        );
                }
                this.bridgeInProblem[bridgeid] = false;

                this.refreshMenu();

                this._checkHueLightsIsStreaming(bridgeid);
            }
        );

        this.hue.instances[bridgeid].connect(
            "lights-data",
            () => {
                this.checkNotifications(
                    bridgeid,
                    this.hue.instances[bridgeid].getAsyncData()
                );
            }
        );

        this.hue.instances[bridgeid].connect(
            "connection-problem",
            () => {
                if (this.bridgeInProblem[bridgeid] !== undefined &&
                    this.bridgeInProblem[bridgeid]) {
                    /* already noticed */
                    return;
                    }

                Main.notify(
                    _("Hue Lights - ") + this.hue.bridges[bridgeid]["name"],
                    _("Please check the connection to Philips Hue bridge ")
                );

                this.bridgeInProblem[bridgeid] = true;

                this._checkHueLightsIsStreaming(bridgeid);
            }
        );
    }

    /**
     * Check if another app already using
     * the entertainment areas
     *
     * @method _checkAnyEntertainmentActive
     * @param {NUmber} bridgeid
     * @return {Boolean} true if already useing
     */
    _checkAnyEntertainmentActive(bridgeid) {
        for (let groupid in this.bridesData[bridgeid]["groups"]) {
            if (this.bridesData[bridgeid]["groups"][groupid]["type"] === "Entertainment" &&
                this.bridesData[bridgeid]["groups"][groupid]["stream"]["active"]) {

                Utils.logDebug(`Another app already streaming group ${groupid} on bridge ${bridgeid}`);

                Main.notify(
                    _("Hue Lights - ") + this.hue.bridges[bridgeid]["name"],
                    _("Another app is already using the entertainment areas.")
                );
                return true;
            }
        }

        return false;
    }

    /**
     * Initialize entertainment stream
     * based on settings. If tehre is a autostart
     * entertainment area, start it.
     *
     * @method entertainmentInit
     * @param {Number} bridgeid
     */
    entertainmentInit(bridgeid) {

        Utils.logDebug(`Bridge ${bridgeid} is initializing entertainment.`);

        if (this._isStreaming[bridgeid] === undefined) {
            this._isStreaming[bridgeid] = {};

            this._isStreaming[bridgeid]["state"] = StreamState.STOPPED;

            if (this._entertainment[bridgeid] !== undefined &&
                this._entertainment[bridgeid]["intensity"] !== undefined) {

                this._isStreaming[bridgeid]["intensity"] = this._entertainment[bridgeid]["intensity"];
            } else {
                this._isStreaming[bridgeid]["intensity"] = 150;
            }

            if (this._entertainment[bridgeid] !== undefined &&
                this._entertainment[bridgeid]["bri"] !== undefined) {

                this._isStreaming[bridgeid]["brightness"] = this._entertainment[bridgeid]["bri"];
            } else {
                this._isStreaming[bridgeid]["brightness"] = 254;
            }

            if (this._entertainment[bridgeid] !== undefined &&
                this._entertainment[bridgeid]["mode"] !== undefined) {

                this._isStreaming[bridgeid]["entertainmentMode"] = this._entertainment[bridgeid]["mode"];
            } else {
                this._isStreaming[bridgeid]["entertainmentMode"] = Utils.entertainmentMode.SYNC;
            }
        }

        if (this._entertainment[bridgeid] !== undefined &&
            this._entertainment[bridgeid]["autostart"] !== undefined &&
            this._entertainment[bridgeid]["autostart"] >= 0) {

            let groupid = this._entertainment[bridgeid]["autostart"];

            Utils.logDebug(`Entertainment init tries to autostart group ${groupid} on bridge ${bridgeid}`);

            if (this.bridesData[bridgeid]["groups"][groupid] === undefined) {
                return;
            }

            if (this.bridesData[bridgeid]["groups"][groupid]["type"] !== "Entertainment") {
                return;
            }

            if (this._checkAnyEntertainmentActive(bridgeid)) {

                Utils.logDebug(`Entertainment init will not autostart group: ${groupid}`);
                return;
            }

            this._isStreaming[bridgeid]["state"] = StreamState.STARTING;

            this._isStreaming[bridgeid]["groupid"] = groupid;

            if (this._entertainment[bridgeid]["mode"] !== undefined) {
                this._isStreaming[bridgeid]["entertainmentMode"] = this._entertainment[bridgeid]["mode"];
            } else {
                this._isStreaming[bridgeid]["entertainmentMode"] = Utils.entertainmentMode.SYNC;
            }

            this.hue.instances[bridgeid].enableStream(
                groupid,
            );
        }
    }

    /**
     * Disable entertainments streams
     * on extension disable.
     * This is done in synchronous mode
     * besause destroy of the extension
     * follows.
     * 
     * @method disableStreams
     */
    disableStreams() {

        Utils.logDebug(`Disabling all streams (using sync mode).`);

        this.hue.disableAsyncMode();

        for (let bridgeid in this.hue.instances) {

            if (this._isStreaming[bridgeid] === undefined ||
                this._isStreaming[bridgeid]["state"] === StreamState.STOPPED) {

                continue;
            }

            this._isStreaming[bridgeid]["state"] = StreamState.STOPPING;

            if (this._isStreaming[bridgeid]["entertainment"] !== undefined) {

                this._isStreaming[bridgeid]["entertainment"].closeBridge();
                if (this._isStreaming[bridgeid]["groupid"] !== undefined) {
                    this.hue.instances[bridgeid].disableStream(
                        this._isStreaming[bridgeid]["groupid"]
                    );
                }

                delete(this._isStreaming[bridgeid]["entertainment"]);
                delete(this._isStreaming[bridgeid]["entertainmentMode"])
            }

            this._isStreaming[bridgeid]["state"] = StreamState.STOPPED;
        }
    }

    /**
     * Prepare list of bridges shown in the menu.
     * 
     * @method getBridgesInMenu
     * @return {Object} Array of bridges for creating menu.
     */
    getBridgesInMenu(currentBridges) {
        let bridges = [];

        /* if at least one current bridge is online, don't change */
        for (let bridgeid of currentBridges) {
            if (this.hue.instances[bridgeid] === undefined) {
                continue;
            }

            if (this.hue.instances[bridgeid].isConnected()){
                return currentBridges;
            }

        }

        let defaultExists = false;
        for (let bridgeid in this.hue.bridges) {
            if (this.hue.bridges[bridgeid]["default"] === undefined) {
                continue;
            }

            if (this.hue.bridges[bridgeid]["default"]!== bridgeid) {
                continue;
            }

            if (this.hue.instances[bridgeid] === undefined){
                continue;
            }

            if (!this.hue.instances[bridgeid].isConnected()){
                continue;
            }

            bridges.push(bridgeid);
            defaultExists = true;
        }

        if (!defaultExists) {
            for (let bridgeid in this.hue.instances) {
                bridges.push(bridgeid);
            }
        }

        return bridges;
    }

    /**
     * Creates Refresh menu item and
     * settings item. Items can be in one item
     * or multipe items.
     * 
     * @method _createSettingItems
     * @param {Boolean} true for reduced number of items
     * @return {Object} array of menu items
     */
    _createSettingItems(reduced) {
        let icon;
        let items = [];

        if (!reduced) {
            /**
             * Switch menu
             */
            let swichMenuText;
            if (this._compactMenu) {
                swichMenuText = _("Switch to standard menu");
            }
            if (!this._compactMenu) {
                swichMenuText = _("Switch to compact menu");
            }
            let switchMenuItem = new PopupMenu.PopupMenuItem(
                swichMenuText
            );

            if (this._iconPack !== PhueIconPack.NONE) {
                icon = this._getIconByPath(Me.dir.get_path() + "/media/HueIcons/settingsSoftwareUpdate.svg");

                if (icon !== null){
                    switchMenuItem.insert_child_at_index(icon, 1);
                }
            }

            switchMenuItem.connect(
                'button-press-event',
                () => {
                    this._compactMenu = !this._compactMenu;
                    this.rebuildMenu();
                }
            );

            items.push(switchMenuItem);
        }

        /**
         * Refresh menu item
         */
        let refreshMenuItem = new PopupMenu.PopupMenuItem(
            _("Refresh menu")
        );

        if (this._iconPack !== PhueIconPack.NONE) {
            icon = this._getGnomeIcon("emblem-synchronizing-symbolic");

            if (icon !== null){
                refreshMenuItem.insert_child_at_index(icon, 1);
            }
        }

        refreshMenuItem.connect(
            'button-press-event',
            () => { this.rebuildMenu(); }
        );

        items.push(refreshMenuItem);

        /**
         * Settings menu item
         */
        let prefsMenuItem = new PopupMenu.PopupMenuItem(
            _("Settings")
        );

        if (this._iconPack !== PhueIconPack.NONE) {
            icon = this._getIconByPath(Me.dir.get_path() + "/media/HueIcons/tabbarSettings.svg");

            if (icon !== null) {
                prefsMenuItem.insert_child_at_index(icon, 1);
            }
        }

        prefsMenuItem.connect(
            'button-press-event',
            () => {Util.spawn(["gnome-shell-extension-prefs", Me.uuid]);}
        );
        items.push(prefsMenuItem);

        return items;
    }

    /**
     * Rebuild the menu from scratch
     * 
     * @method rebuildMenu
     */
    rebuildMenu() {

        Utils.logDebug("Rebuilding menu.");

        let bridgeItems = [];
        let oldItems = this.menu._getMenuItems();
        let instanceCounter = 0;
        this.colorPicker = null;
        this._openMenuDefault = null;
        this.refreshMenuObjects = {};

        this.hue.disableAsyncMode();
        this.bridesData = this.hue.checkBridges(false);
        this.hue.enableAsyncMode();

        this._bridgesInMenu = this.getBridgesInMenu(this._bridgesInMenu);

        for (let item in oldItems){
            oldItems[item].destroy();
        }

        for (let bridgeid of this._bridgesInMenu) {

            if (!this.hue.instances[bridgeid].isConnected()){

                Utils.logDebug(`Bridge ${bridgeid} is not connected.`);
                continue;
            }

            if (instanceCounter > 0) {
                this.menu.addMenuItem(
                    new PopupMenu.PopupSeparatorMenuItem()
                );
            }

            instanceCounter++;
 
            this.hue.instances[bridgeid].disconnectAll;

            this._connectHueInstance(bridgeid);

            this.entertainmentInit(bridgeid);

            if (!this._compactMenu) {
                bridgeItems = this._createMenuBridge(bridgeid);
            }

            if (this._compactMenu) {
                bridgeItems = this._createCompactMenuBridge(bridgeid);
            }

            for (let item in bridgeItems) {
                this.menu.addMenuItem(bridgeItems[item]);
            }
        }

        if (instanceCounter === 0 ) {
            for (let settingsItem of this._createSettingItems(true)) {
                this.menu.addMenuItem(settingsItem);
            }
        }

        this.refreshMenu();
    }

    /**
     * Check and change indicator position in menu.
     * 
     * @method setPositionInPanel
     * @param {Enum} new position in panel
     */
    setPositionInPanel(position) {

        let children = null;

        if (this._indicatorPositionBackUp === this._indicatorPosition) {
            return;
        }

        this.get_parent().remove_actor(this);

        switch (this._indicatorPosition) {

            case PhueMenuPosition.LEFT:

                children = Main.panel._leftBox.get_children();
                Main.panel._leftBox.insert_child_at_index(
                    this,
                    children.length
                );
                break;

            case PhueMenuPosition.CENTER:

                children = Main.panel._centerBox.get_children();
                Main.panel._centerBox.insert_child_at_index(
                    this,
                    children.length
                    );
                break;

            case PhueMenuPosition.RIGHT:

                children = Main.panel._rightBox.get_children();
                Main.panel._rightBox.insert_child_at_index(this, 0);
                break;

            default:
                children = Main.panel._rightBox.get_children();
                Main.panel._rightBox.insert_child_at_index(this, 0);
        }

        this._indicatorPositionBackUp = this._indicatorPosition;
    }

    /**
     * Backup light settings from requested bridge
     * before running notification
     * 
     * @method notifyGetLight
     * @param {String} reqBridgeid
     * @param {Object} lights data
     */
    notifyBackupLight(reqBridgeid, dataLights) {

        let cmd = {};
        let lightState;

        for (let i in this._notifyLights) {

            let bridgeid = i.split("::")[0];
            let lightid = parseInt(i.split("::")[1]);

            if (bridgeid !== reqBridgeid) {
                continue;
            }

            lightState = dataLights[lightid]["state"];

            cmd = {"transitiontime": 0};

            cmd["on"] = lightState["on"];

            cmd["bri"] = lightState["bri"];

            if (lightState["colormode"] == "ct") {
                cmd["ct"] = lightState["ct"];
            }

            if (lightState["colormode"] == "xy") {
                cmd["xy"] = lightState["xy"];
            }

            this.oldNotifylight[i] = cmd;
        }

        Utils.logDebug(`Notify lights backed up: ${JSON.stringify(this.oldNotifylight)}`);
    }

    /**
     * Start light notification on a bridge
     * 
     * @method startNotify
     * @param {String} requested bridge
     */
    startNotify(reqBirdgeid) {

        return new Promise(resolve => {

            Utils.logDebug(`Starting notify lights: ${JSON.stringify(this._notifyLights)}`);

            for (let i in this._notifyLights) {

                let bridgeid = i.split("::")[0];
                let lightid = parseInt(i.split("::")[1]);

                if (reqBirdgeid !== bridgeid) {
                    continue;
                }

                let bri = 254;
                if (this._notifyLights[i]["bri"] !== undefined) {
                    bri = this._notifyLights[i]["bri"];
                }

                let r = 255;
                let g = 255;
                let b = 255;
                if (this._notifyLights[i]["r"] !== undefined) {
                    r = this._notifyLights[i]["r"];
                    g = this._notifyLights[i]["g"];
                    b = this._notifyLights[i]["b"];
                }

                let xy = Utils.colorToHueXY(r, g, b);

                this.hue.instances[bridgeid].setLights(
                    lightid,
                    {"on": true, "bri":bri, "xy":xy, "transitiontime": 0 },
                    PhueRequestype.NO_RESPONSE_NEED
                );

            }

            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this.endNotify(reqBirdgeid);
                return GLib.SOURCE_REMOVE;
            });
            resolve();
        })
    }


    /**
     * End light notification on a bridge
     * 
     * @method endNotify
     * @param {String} requested bridge
     */
    endNotify(reqBirdgeid) {

        if (this.oldNotifylight === undefined) {
            return;
        }

        Utils.logDebug(`Ending notify lights: ${JSON.stringify(this.oldNotifylight)}`);

        for (let i in this._notifyLights) {

            let bridgeid = i.split("::")[0];
            let lightid = parseInt(i.split("::")[1]);

            if (reqBirdgeid !== bridgeid) {
                continue;
            }

            if (this.oldNotifylight[i] === undefined) {
                continue;
            }

            this.hue.instances[bridgeid].setLights(
                lightid,
                this.oldNotifylight[i],
                PhueRequestype.NO_RESPONSE_NEED
            );
        }
    }

    /**
     * Check if notification should run on bridge
     * 
     * @method checkNotifications
     * @param {String} bridge
     * @param {Object} lights data
     */
    async checkNotifications(birdgeid, dataLights) {

        if (this._waitingNotification) {

            Utils.logDebug("Checking notifications.");

            this.notifyBackupLight(birdgeid, dataLights);
            await this.startNotify(birdgeid);

            this._waitingNotification = false;
        }
    }

    /**
     * A notification occurred in the system.
     * Ask to get lights from all bridges.
     * It will invoke checkNotifications() for all bridges
     * 
     * @method runNotify
     */
    runNotify() {

        Utils.logDebug("Notification happend in the system.");

        this._waitingNotification = true;

        for (let i in this.hue.instances) {
            if (!this.hue.instances[i].isConnected()) {
                continue;
            }

            this.hue.instances[i].getLights();
        }
    }
});
