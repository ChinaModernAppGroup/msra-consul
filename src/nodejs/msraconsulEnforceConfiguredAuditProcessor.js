/*
  Copyright (c) 2017, F5 Networks, Inc.
  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at
  *
  http://www.apache.org/licenses/LICENSE-2.0
  *
  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
  either express or implied. See the License for the specific
  language governing permissions and limitations under the License.

  Updated by Ping Xiong on May/13/2022.
  Updated by Ping Xiong on Jul/2/2022, using global var for polling signal.
  Updated by Ping Xiong on Oct/05/2022, modify the polling signal into a json object to keep more information.
  let blockInstance = {
    name: "instanceName", // a block instance of the iapplx config
    state: "polling", // can be "polling" for normal running state; "update" to modify the iapplx config
    serviceId: "inputNodeName + ":" + inputVirtualServer + ":" + inputServiceName", what's the ID for consul?
  }
*/

'use strict';


//var q = require("q");

var blockUtil = require("./blockUtils");
var logger = require("f5-logger").getInstance();
//var fs = require('fs');

// Setup a signal for onpolling status. It has an initial state "false".
//const msraconsulOnPollingSignal = '/var/tmp/msraconsulOnPolling';
//var msraOnPolling = false;


function msraconsulEnforceConfiguredAuditProcessor() {
    // you can also use this.logger on a RestWorker
    // Using directly from require (below) is another way to call log events
    logger.info("loading msraconsul Enforce Configured Audit Processor");
}

// For logging, show the number of the audit cycle. Increments on each new "turn" of the auditor
var entryCounter = 0;

var getLogHeader = function () {
    return "AUDIT #" + entryCounter + ": ";
};


msraconsulEnforceConfiguredAuditProcessor.prototype.WORKER_URI_PATH = "shared/iapp/processors/msraconsulEnforceConfiguredAudit";

msraconsulEnforceConfiguredAuditProcessor.prototype.onStart = function (success) {
    logger.fine("msraconsulEnforceConfiguredAuditProcessor.prototype.onStart");
    //logger.fine("MSRA consul Audit onStart: ConfigProcessor polling state: ");
    this.apiStatus = this.API_STATUS.INTERNAL_ONLY;
    this.isPublic = true;
 
/*
    icr.initialize( {
        restOperationFactory: this.restOperationFactory,
        restHelper: this.restHelper,
        wellKnownPorts: this.wellKnownPorts,
        referrer: this.referrer,
        restRequestSender: this.restRequestSender
    });
*/
    success();
};


// The incoming restOperation contains the current Block.
// Populate auditTaskState.currentInputProperties with the values on the device.
// In ENFORCE_CONFIGURED, ignore the found configuration is on the BigIP.
msraconsulEnforceConfiguredAuditProcessor.prototype.onPost = function (restOperation) {
  entryCounter++;
  logger.fine(getLogHeader() + "msra Audit onPost: START");
  var oThis = this;
  var auditTaskState = restOperation.getBody();

  //setTimeout(function () {
    try {
      if (!auditTaskState) {
        throw new Error("AUDIT: Audit task state must exist ");
      }
      /*
        logger.fine(getLogHeader() + "Incoming properties: " +
            this.restHelper.jsonPrinter(auditTaskState.currentInputProperties));
      */

      var blockInputProperties = blockUtil.getMapFromPropertiesAndValidate(
        auditTaskState.currentInputProperties,
        [
          "consulEndpoint",
          "node",
          "nodeIpAddr",
          "virtualServer",
          "serviceName",
          "serviceIpAddr",
          "servicePort"
        ]
      );

      //const serviceID = blockInputProperties.node.value + ":" + blockInputProperties.serviceName.value;
      const serviceId =
        blockInputProperties.node.value +
        ":" +
        blockInputProperties.virtualServer.value +
        ":" +
        blockInputProperties.serviceName.value;
      
      // Check the polling state, trigger ConfigProcessor if needed.
      // Move the signal checking here
      logger.fine(
        "getLogHeader() + MSRA consul Audit msraconsulOnpolling: ",
        global.msraconsulOnPolling
      );
      logger.fine(
        getLogHeader() + "MSRA consul Audit msraconsul serviceName: ",
        blockInputProperties.serviceName.value
      );
      logger.fine(
        getLogHeader() + "MSRA consul Audit msraconsul serviceId: ",
        serviceId
      );
      if (
          global.msraconsulOnPolling.some(
            (instance) => instance.serviceId === serviceId
          )
      ) {
          logger.fine(
            getLogHeader() +
              "MSRA consul Audit onPost: ConfigProcessor is on polling state, no need to fire an onPost.",
            serviceId
          );
          oThis.finishOperation(restOperation, auditTaskState);
      } else {
          logger.fine(
            getLogHeader() +
              "MSRA consul Audit onPost: ConfigProcessor is NOT on polling state, will trigger ConfigProcessor onPost.",
            serviceId
          );
        try {
          var poolNameObject = getObjectByID(
            "serviceName",
            auditTaskState.currentInputProperties
          );
          poolNameObject.value = null;
          oThis.finishOperation(restOperation, auditTaskState);
          logger.fine(
            getLogHeader() +
              "MSRA consul Audit onPost: trigger ConfigProcessor onPost ",
            serviceId
          );
        } catch (err) {
          logger.fine(
            getLogHeader() +
              "MSRA consul Audit onPost: Failed to send out restOperation. ",
            err.message
          );
        }
      }
    } catch (ex) {
      logger.fine(
        getLogHeader() +
          "msraconsulEnforceConfiguredAuditProcessor.prototype.onPost caught generic exception ",
        ex
      );
      restOperation.fail(ex);
    }
  //}, 2000);
};

var getObjectByID = function ( key, array) {
    var foundItArray = array.filter( function( item ) {
        return item.id === key;
    });
    return foundItArray[0];
};

msraconsulEnforceConfiguredAuditProcessor.prototype.finishOperation = function( restOperation, auditTaskState ) {
    restOperation.setBody(auditTaskState);
    this.completeRestOperation(restOperation);
    logger.fine(getLogHeader() + "DONE" );
};

module.exports = msraconsulEnforceConfiguredAuditProcessor;
