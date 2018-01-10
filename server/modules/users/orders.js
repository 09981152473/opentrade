'use strict';

const utils = require("../../utils.js");
const g_constants = require("../../constants.js");
const WebSocket = require('ws');
const wallet = require("./wallet");
const database = require("../../database");

let userOrders = {};
let allOrders = {};

function onError(req, res, message)
{
    utils.renderJSON(req, res, {result: false, message: message});
}
function onSuccess(req, res, data)
{
    utils.renderJSON(req, res, {result: true, data: data});
}

exports.CloseOrder = function(req, res)
{
    if (!req || !req.body || !req.body.orderID)
    {
        onError(req, res, req.message || 'Bad request');
        return;
    }
    
    utils.GetSessionStatus(req, status => {
        if (!status.active)
        {
            onError(req, res, 'User not logged');
            return;
        }
        
        const WHERE_ORDER = 'userID="'+status.id+'" AND ROWID="'+escape(req.body.orderID)+'"';
        g_constants.dbTables['orders'].selectAll('ROWID AS id, *', WHERE_ORDER, '', (err, rows) => {
            if (err || !rows || !rows.length)
            {
                onError(req, res, err ? err.message || 'Order not found' : 'Order not found');
                return;
            }
            const order = rows[0];
            const fullAmount = order.buysell == 'buy' ?
                    (order.amount*order.price+g_constants.TRADE_COMISSION*order.amount*order.price).toFixed(7)*1 :
                    (order.amount*1).toFixed(7)*1;
                    
            const coinBalance = order.buysell == 'buy' ? order.price_pair : order.coin;
            
            const WHERE_BALANCE = 'userID="'+status.id+'" AND coin="'+coinBalance+'"';
            g_constants.dbTables['balance'].selectAll('*', WHERE_BALANCE, '', (err, rows) => {
                if (err || !rows || !rows.length)
                {
                    onError(req, res, err.message || 'Balance not found');
                    return;
                }
                
                const newBalance = rows[0].balance*1 + fullAmount;
                database.BeginTransaction(err => {
                    if (err)
                    {
                        onError(req, res, err.message || 'Database transaction error');
                        return;
                    }
                    
                    g_constants.dbTables['orders'].delete(WHERE_ORDER, err => {
                        if (err)
                        {
                            database.RollbackTransaction();
                            onError(req, res, err.message || 'Database Delete error');
                            return;
                        }
                        
                        g_constants.dbTables['balance'].update('balance="'+(newBalance*1).toFixed(7)*1+'"', WHERE_BALANCE, err => {
                            if (err)
                            {
                                database.RollbackTransaction();
                                onError(req, res, err.message || 'Database Update error');
                                return;
                            }
                            database.EndTransaction();
                            //database.RollbackTransaction();
                            
                            wallet.ResetBalanceCache(status.id);
                            allOrders = {};
                            if (userOrders[status.id])
                                delete userOrders[status.id];
                            
                            onSuccess(req, res, {});
                        });
                    });
                });
                
            })
        });
    });    
}

exports.SubmitOrder = function(req, res)
{
    utils.GetSessionStatus(req, status => {
        if (!status.active) return onError(req, res, 'User not logged');

        if (!ValidateOrderRequest(req)) return onError(req, res, req.message || 'Bad request');

        utils.CheckCoin(req.body.coin, err => {
            if (err && err.result == false) return onError(req, res, err.message);

            const WHERE = req.body.order == 'buy' ? 
                'coin="'+escape(g_constants.TRADE_MAIN_COIN)+'" AND userID="'+status.id+'"' :
                'coin="'+escape(req.body.coin)+'" AND userID="'+status.id+'"';
            g_constants.dbTables['balance'].selectAll('*', WHERE, '', (err, rows) => {
                if (err || !rows || !rows.length) return onError(req, res, err.message || 'User balance not found');

                const fullAmount = req.body.order == 'buy' ?
                    (req.body.amount*req.body.price+g_constants.TRADE_COMISSION*req.body.amount*req.body.price).toFixed(7)*1 :
                    (req.body.amount*1).toFixed(7)*1;
                
                if (fullAmount*1 < 0.00001) return onError(req, res, 'Bad order total ( total < 0.00001 ) '+'( '+fullAmount*1+' < 0.00001 )');
                if (rows[0].balance*1 < fullAmount) return onError(req, res, 'Insufficient funds ( '+rows[0].balance*1+' < '+fullAmount+' )');

                AddOrder(status, WHERE, rows[0].balance*1-fullAmount, req, res);
            });
        });
    });
};

exports.GetReservedBalance = function(userID, coinName, callback)
{
    if (coinName != g_constants.TRADE_MAIN_COIN)
    {
        g_constants.dbTables['orders'].selectAll('SUM(amount) AS result', 'userID="'+userID+'" AND coin="'+coinName+'" '+'AND buysell="sell"', '', (err, rows) => {
            if (err || !rows) return callback({result: 'fail', message: err.message || 'Database error'});

            callback({result: 'success', data: rows.length ? rows[0].result*1 : 0.0});
        });
        return;
    }
    g_constants.dbTables['orders'].selectAll('SUM(amount*price) AS result', 'userID="'+userID+'" AND buysell="buy"', '', (err, rows) => {
        if (err || !rows) return callback({result: 'fail', message: err.message || 'Database error'});

        callback({result: 'success', data: rows.length ? rows[0].result*1 : 0.0});
    });
}

exports.GetUserOrders = function(userID, coins, callback)
{
    let WHERE = 'userID="'+userID;
    
    if (coins.length)
        WHERE += '"  AND amount>0 AND ( ';
        
    for (let i=0; i<coins.length; i++)
    {
        WHERE += " coin='"+coins[i].name+"' ";
        if (i != coins.length-1)
            WHERE += " OR ";
        else
            WHERE += " ) ";
    }
    
    if (userOrders[userID] && userOrders[userID][WHERE] && Date.now() - userOrders[userID][WHERE].time < 120000)
    {
        callback({result: true, data: userOrders[userID][WHERE].data});
        return;
    }
    
    g_constants.dbTables['orders'].selectAll('ROWID AS id, *', WHERE, 'ORDER BY time DESC', (err, rows) => {
        userOrders[userID] = {};
        userOrders[userID][WHERE] = {time: Date.now()};
        if (err)
        {
            callback({result: false, message: err.message || 'Unknown database error'});
            return;
        }
        userOrders[userID][WHERE]['data'] = rows;
        callback({result: true, data: rows});
    });
}

exports.GetAllOrders = function(coinsOrigin, callback)
{
    let coins = [coinsOrigin[0], coinsOrigin[1]];
    if (coins[0].name == g_constants.TRADE_MAIN_COIN)
        coins = [coinsOrigin[1], coinsOrigin[0]];
        
    if (allOrders[coins[0].name] == 'Yenten')
    {
        var i=0;
    }
    if (coins.length != 2)
    {
        callback({result: false, message: 'Coins error'});
        return;
    }
    
    if (allOrders[coins[0].name] && Date.now() - allOrders[coins[0].name].time < 5000)
    {
        callback({result: true, data: allOrders[coins[0].name].data});
        return;
    }
    
    g_constants.dbTables['orders'].selectAll('SUM(amount) AS amount, coin, price, time', 'coin="'+escape(coins[0].name)+'" AND buysell="buy" AND amount*1>0', 'GROUP BY price ORDER BY price*1000000 DESC LIMIT 30', (err, rows) => {
        g_constants.dbTables['orders'].selectAll('SUM(amount) AS amount, coin, price, time', 'coin="'+escape(coins[0].name)+'" AND buysell="sell" AND amount*1>0', 'GROUP BY price ORDER BY price*1000000 LIMIT 30', (err2, rows2) => {
            const data = {buy: rows || [], sell: rows2 || []};
            allOrders[coins[0].name] = {time: Date.now(), data: data};
            callback({result: true, data: data});
            
            ProcessExchange(data);
        });
    });
}


function ValidateOrderRequest(req)
{
    if (!req) req = {};
    if (!req.body || !req.body.order || !req.body.coin || !req.body.amount || !req.body.price)
    {
        req['message'] = 'Bad request';
        return false;
    }
    if (req.body.amount*1 < 0.00001)
    {
        req['message'] = 'Bad order amount ( amount < 0.00001 ) '+'( '+req.body.amount*1+' < 0.00001 )';
        return false;
    }
    if (req.body.price*1 < 0.00001)
    {
        req['message'] = 'Bad order price ( price < 0.00001 )'+' ( '+req.body.price*1+' < 0.00001 )';
        return false;
    }
    return true;
}

function AddOrder(status, WHERE, newBalance, req, res)
{
    database.BeginTransaction(err => {
        if (err) return onError(req, res, err.message || 'Database transaction error');

        g_constants.dbTables['orders'].insert(
            status.id,
            req.body.coin,
            req.body.order,
            req.body.amount,
            req.body.price,
            g_constants.TRADE_MAIN_COIN,
            Date.now(),
            JSON.stringify({}),
            err => {
                if (err)
                {
                    database.EndTransaction();
                    onError(req, res, err.message || 'Database Insert error');
                    return;
                }
                
                g_constants.dbTables['balance'].update('balance="'+(newBalance*1).toFixed(7)*1+'"', WHERE, err => {
                    if (err)
                    {
                        database.RollbackTransaction();
                        onError(req, res, err.message || 'Database Update error');
                        return;
                    }
                    database.EndTransaction();
                    
                    wallet.ResetBalanceCache(status.id);
                    allOrders = {};
                    if (userOrders[status.id])
                        delete userOrders[status.id];
                    
                    onSuccess(req, res, {});
                });
            }
        );
    });
}

function ProcessExchange(data)
{
    if (!data.buy.length || !data.sell.length)
        return;
        
    const higestBid = data.buy[0];
    const higestAsk = data.sell[0];
    
    if (higestBid.price*1 < higestAsk.price*1)
        return
    
    const WHERE = 'coin="'+higestBid.coin+'"  AND amount>0 AND ((buysell="sell" AND price*1000000 <= '+higestBid.price*1000000+') OR (buysell="buy" AND price*1000000 >= '+higestAsk.price*1000000+'))';    
    g_constants.dbTables['orders'].selectAll('ROWID AS id, *', WHERE, 'ORDER BY price, time', (err, rows) => {
        if (err || !rows || !rows.length)
            return;
        
        const first = rows[0];
        const second = GetPair(first, rows);
        
        if (second == null)
            return;
        
        if (first.buysell == 'buy')    
            RunExchange(first, second);
        else
            RunExchange(second, first);
    });
    
    function GetPair(first, rows)
    {
        for (var i=1; i<rows.length; i++)
        {
            if (i > 100) return null;
            if (first.buysell == 'buy' && rows[i].buysell == 'sell' && first.price*1 >= rows[i].price*1)
                return rows[i];
            if (first.buysell == 'sell' && rows[i].buysell == 'buy' && first.price*1 <= rows[i].price*1)
                return rows[i];
        }
        return null;
    }
    
    function RunExchange(buyOrder, sellOrder)
    {
        const newBuyAmount = buyOrder.amount*1 < sellOrder.amount*1 ? 0 : (buyOrder.amount*1 - sellOrder.amount*1).toPrecision(8);
        const newSellAmount = buyOrder.amount*1 < sellOrder.amount*1 ? (sellOrder.amount*1 - buyOrder.amount*1).toPrecision(8) : 0;
        
        const fromSellerToBuyer = (buyOrder.amount*1 - newBuyAmount*1).toPrecision(8);
        const fromBuyerToSeller = (fromSellerToBuyer*sellOrder.price).toPrecision(8);
        
        //if (fromSellerToBuyer*1 == 0 || fromBuyerToSeller*1 == 0 )
        //    return;
        
        const comission = (fromBuyerToSeller*g_constants.TRADE_COMISSION*1).toPrecision(8);
        
        const buyerChange = ((buyOrder.price*1 - sellOrder.price*1)*fromSellerToBuyer).toPrecision(8);

        database.BeginTransaction(err => {
            if (err) return;
                
            UpdateOrders(newBuyAmount, newSellAmount, buyOrder.id, sellOrder.id, err => {
                if (err) return database.RollbackTransaction();
                
                UpdateBalances(buyOrder, sellOrder, fromSellerToBuyer, fromBuyerToSeller, buyerChange, comission, err => {
                    if (err) return database.RollbackTransaction();
                    
                    UpdateHistory(buyOrder, sellOrder, fromSellerToBuyer, fromBuyerToSeller, buyerChange, comission, err => {
                        if (err) return database.RollbackTransaction();
                        
                        database.EndTransaction();
                        
                        wallet.ResetBalanceCache(buyOrder.userID);
                        wallet.ResetBalanceCache(sellOrder.userID);
                        allOrders = {};
                        if (userOrders[sellOrder.userID])
                            delete userOrders[sellOrder.userID];
                        if (userOrders[buyOrder.userID])
                            delete userOrders[buyOrder.userID];
                            
                        // Broadcast to everyone else.
                        g_constants.WEB_SOCKETS.clients.forEach( client => {
                            if (client.readyState === WebSocket.OPEN) 
                                client.send(JSON.stringify({request: 'exchange-updated', message: {coin: buyOrder.coin}}));
                        });
                    });
                });
            });
        });
    }
    
    function UpdateHistory(buyOrder, sellOrder, fromSellerToBuyer, fromBuyerToSeller, buyerChange, comission, callback)
    {
        const buysell = buyOrder.time*1 < sellOrder.time*1 ? 'buy' : 'sell';
        g_constants.dbTables['history'].insert(
            buyOrder.userID,
            sellOrder.userID,
            buyOrder.coin,
            sellOrder.price_pair,
            fromSellerToBuyer, //volume
            fromBuyerToSeller,
            buyerChange,
            comission,
            Date.now(),
            buysell,
            (sellOrder.price*1).toPrecision(8),
            JSON.stringify({}),
            callback
        );
    }
    
    function UpdateBalances(buyOrder, sellOrder, fromSellerToBuyer, fromBuyerToSeller, buyerChange, comission, callback)
    {
        exports.AddBalance(buyOrder.userID, fromSellerToBuyer, buyOrder.coin, err => {
            if (err) return callback(err);

            exports.AddBalance(sellOrder.userID, fromBuyerToSeller, sellOrder.price_pair, err => {
                if (err) return callback(err);

                exports.AddBalance(buyOrder.userID, buyerChange, sellOrder.price_pair, err => {
                    callback(err);
                    ProcessComission(comission, sellOrder.price_pair);
                });
            });
        });
    }
    
    function ProcessComission(comission, price_pair)
    {
        for (var i=0; i<g_constants.DONATORS; i++)
        {
            if (g_constants.DONATORS[i].percent && g_constants.DONATORS[i].userID)
                exports.AddBalance(g_constants.DONATORS[i].userID, (comission*(g_constants.DONATORS[i].percent*1-1)) / 100.0, price_pair, () => {});
        }
    }
    
    function UpdateOrders(newBuyAmount, newSellAmount, buyOrderID, sellOrderID, callback)
    {
        g_constants.dbTables['orders'].update('amount="'+newBuyAmount+'"', 'ROWID="'+buyOrderID+'"', err => {
            if (err) return callback(err);

            g_constants.dbTables['orders'].update('amount="'+newSellAmount+'"', 'ROWID="'+sellOrderID+'"', err => {
                if (err) return callback(err);
                
                g_constants.dbTables['orders'].delete('amount*1=0');
                callback(null);
            });
        });
    }
}

exports.AddBalance = function(userID, count, coin, callback)
{
    const WHERE = 'userID="'+userID+'" AND coin="'+coin+'"';
    g_constants.dbTables['balance'].selectAll('*', WHERE, '', (err, rows) => {
        if (err || !rows) return callback(err);
        
        const newBalance = rows.length ? rows[0].balance*1 + count*1 : count;
        
        if (rows.length)
        {
            g_constants.dbTables['balance'].update('balance="'+newBalance.toPrecision(8)+'"', WHERE, callback);
            return;
        }
        g_constants.dbTables['balance'].insert(
            userID,
            coin,
            (newBalance*1).toFixed(8),
            JSON.stringify({}),
            JSON.stringify({}),
            callback
        );
    });
}