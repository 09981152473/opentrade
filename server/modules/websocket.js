'use strict';

const utils = require("../utils.js");
const g_constants = require("../constants.js");
const chat = require("./users/chat");
const wallet = require("./users/wallet");
const coins = require("./admin/coins");

exports.onConnect = function(ws, req)
{
   //ws.on('open', function open() {});

    const request = req;
    ws.on('message', data => {
        if (!data || !data.length)
        {
            SendError(ws, 'Error: empty message');
            return;
        }
        let client = {};
        try {
            client = JSON.parse(data);
        } catch(e) {
            SendError(ws, 'Error: '+e.message);    
            return;
        }
        
        if (!client.request)
        {
            SendError(ws, 'Error: request not found');
            return;
        }
        SendResponce(ws, request, client);
    });
}

function SendResponce(ws, req, client)
{
    ws['client_request'] = client.request;
    if (client.request == 'getchat')
    {
        chat.onRequestMessages(ws);
        return;
    }
    if (client.request == 'postchat')
    {
        chat.onNewMessage(ws, req, client.message);
        return;
    }
    if (client.request == 'admincoins')
    {
        coins.onGetCoins(ws, req);
        return;
    }
    if (client.request == 'newcoin')
    {
        coins.onNewCoin(ws, req, client.message);
        return;
    }
    if (client.request == "rpc_test")
    {
        coins.onTestRPC(ws, req, client.message);
        return;
    }
    if (client.request == "getwallet")
    {
        wallet.onGetWallet(ws, req);
        return;
    }
    SendError(ws, 'Error: invalid request');
}

function SendError(ws, message)
{
    ws.send(JSON.stringify({request: 'error', message: message}));
}