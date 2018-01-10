'use strict';

google.charts.load('current', {packages: ['corechart']});
google.charts.setOnLoadCallback(drawChart);

var g_CurrentPair = utils.DEFAULT_PAIR;

var pairData = {};

var coinNameToTicker = {};

var chartData = [];

$(() => {
  utils.CreateSocket(onSocketMessage, onOpenSocket);

  $('#button_chat').click(event => {
        event.preventDefault();
        SendChatMessage();
  });

  const currentPair = storage.getItem('CurrentPair');
  if (currentPair != null)
    g_CurrentPair = currentPair.value;
    
  $('#header_sell').text('Sell '+g_CurrentPair);
  $('#header_buy').text('Buy '+g_CurrentPair);
  
});

$('#form_buy').submit(e => {
  e.preventDefault();
  
  try
  {
    const amount = $('#inputBuyAmount').val()*1;
    const price = $('#inputBuyPrice').val()*1;
    
    const order = {order: 'buy', coin: g_CurrentPair, amount: amount, price: price};
    AddOrder(order);
  }
  catch(e)
  {}
  
});

$('#form_sell').submit(e => {
  e.preventDefault();

  try
  {
    const amount = $('#inputSellAmount').val()*1;
    const price = $('#inputSellPrice').val()*1;
    
    const order = {order: 'sell', coin: g_CurrentPair, amount: amount, price: price};
    AddOrder(order);
  }
  catch(e)
  {}
  
});

function AddOrder(order)
{
    $('#loader').show();
    $.post( "/submitorder", order, function( data ) {
      $('#loader').hide();
      if (data.result != true)
      {
        utils.alert_fail(data.message);
        return;
      }
      utils.alert_success('Your order is submitted!');
      socket.send(JSON.stringify({request: 'getpair', message: [utils.MAIN_COIN, g_CurrentPair]}));
    }, "json" );
  
}

function SendChatMessage()
{
  socket.send(JSON.stringify({request: 'postchat', message: {text: $('#chat_message').val()}}));
  $('#chat_message').val('');
}

function onOpenSocket()
{
  socket.send(JSON.stringify({request: 'getchat'}));
  socket.send(JSON.stringify({request: 'getchart', message: [utils.MAIN_COIN, g_CurrentPair]}));
  socket.send(JSON.stringify({request: 'getpair', message: [utils.MAIN_COIN, g_CurrentPair]}));

  setInterval(()=>{socket.send(JSON.stringify({request: 'getpair', message: [utils.MAIN_COIN, g_CurrentPair]}));}, 5000)
}

function onSocketMessage(event)
{
  var data = {};
  try { data = JSON.parse(event.data); }
  catch(e) {return;}
  
  if (!data.request || data.request == 'error' || !data.message)
    return;
    
  if (data.request == 'chat-message')
  {
    AddChatMessage(data.message)
    return;
  }
  if (data.request == 'chat-messages')
  {
    $('#chat-container').empty();
    for (var i=0; i<data.message.length; i++)
      AddChatMessage(data.message[i])
    return;
  }
  if (data.request == 'pairdata')
  {
    UpdatePairData(data.message)
    return;
  }
  if (data.request == 'chartdata')
  {
    if (data.message.data.chart)
    {
      chartData = data.message.data.chart;
      drawChart();
    }
    return;
  }
  if (data.request == 'pairbalance')
  {
    UpdatePairBalance(data.message)
    return;
  }
  if (data.request == 'wallet')
  {
    UpdateBalance(data.message);
    return;
  }
  if (data.request == 'market')
  {
    UpdateMarket(data.message)
    return;
  }
  if (data.request == 'exchange-updated')
  {
    UpdateExchange(data.message);
    return;
  }
}

function UpdateExchange(message)
{
  if (!message || !message.coin || message.coin != g_CurrentPair)
    return;
  
  socket.send(JSON.stringify({request: 'getpair', message: [utils.MAIN_COIN, g_CurrentPair]}));
}

function UpdateMarket(message)
{
  if (!message || !message.coins || !message.coins.length)
    return;
  
  $('#table-market').empty();  
  for (var i=0; i<message.coins.length; i++)
  {
    const coinName = message.coins[i].name;
    
    coinNameToTicker[coinName] = {ticker: message.coins[i].ticker};
    
    if (coinName == utils.MAIN_COIN)
      continue;
      
    const price = (message.coins[i].price*1).toFixed(8);
    const vol = (message.coins[i].volume*1).toFixed(8);
    const ch = message.coins[i].prev_price ? (message.coins[i].price*1 - message.coins[i].prev_price*1) : message.coins[i].price*1;
    
    const chColor = ch*1 < 0 ? "text-danger" : "text-success";
    
    const tr = $('<tr></tr>')
      .append($('<td>'+message.coins[i].ticker+'</td>'))
      .append($('<td>'+price+'</td>'))
      .append($('<td>'+vol+'</td>'))
      .append($('<td><span class="'+chColor+'">'+(ch*1).toFixed(7)+'</span></td>'))
      .on('click', e => {
        if (coinName == g_CurrentPair)
          return;
        storage.setItem('CurrentPair', coinName);
        location.reload(); 
      });
      
    $('#table-market').append(tr);
  }
  
  if (!$('#id_buy_orders_header_price').length)
  {
    $('#id_buy_orders_header').append($('<th id="id_buy_orders_header_price">Price</th><th>'+coinNameToTicker[utils.MAIN_COIN].ticker+'</th><th>'+coinNameToTicker[g_CurrentPair].ticker+'</th>'))
    $('#id_sell_orders_header').append($('<th>Price</th><th>'+coinNameToTicker[utils.MAIN_COIN].ticker+'</th><th>'+coinNameToTicker[g_CurrentPair].ticker+'</th>'))
  }
}

function AddChatMessage(message)
{
  const user = $('<a href="#"></a>').text(message.user+":");
  const text = $('<span class="p-2"></span>').text(message.message.text);
  $('#chat-container').append($('<div class="row chat_row"></div>').append($('<div class="col-md-12"></div>').append(user).append(text)));
  
  $('#chat-flex').animate({scrollTop: $('#chat-container').height()}, 0);
}

function UpdatePairData(message)
{
  if (!message || !message.result || !message.data)
    return;
  
  if (message.data.orders)
    UpdateOrders(message.data.orders);
  if (message.data.userOrders)
    UpdateUserOrders(message.data.userOrders);
  if (message.data.history)
    UpdateTradeHistory(message.data.history);
  if (message.data.online != undefined)
    $('#id_chat_header').html('<span>Online: </span><strong>'+message.data.online+'</strong>')
}

function UpdatePairBalance(message)
{
  
}

function UpdateTradeHistory(history)
{
  $('#id_trade_history').empty();
  for (var i=0; i<history.length; i++)
  {
    if (!history[i].time)
      continue;
      
    history[i].buysell = history[i].buysell == 'sell' ? 'buy' : 'sell';
    
    const typeColor = history[i].buysell == 'sell' ? "text-danger" : "text-success";
    const tr = $('<tr></tr>')
      .append($('<td>'+utils.timeConverter(history[i].time*1)+'</td>'))
      .append($('<td><p class="'+typeColor+'">'+history[i].buysell+'</p></td>'))
      .append($('<td>'+(history[i].volume*1).toFixed(8)+'</td>'))
      .append($('<td>'+(history[i].price*1).toFixed(8)+'</td>'));
    
    $('#id_trade_history').append(tr);
  }
}

function UpdateOrders(orders)
{
  if (!orders.buy || !orders.sell)
    return;
    
  $('#id_buy_orders_body').empty();
  $('#id_sell_orders_body').empty();
  
  for (var i=0; i<orders.buy.length; i++)
  {
    const tr = $('<tr></tr>')
      .append($('<td>'+(orders.buy[i].price*1.0).toFixed(8)+'</td>'))
      .append($('<td>'+(orders.buy[i].price*orders.buy[i].amount*1.0).toFixed(8)+'</td>'))
      .append($('<td>'+(orders.buy[i].amount*1.0).toFixed(8)+'</td>'));
      
    $('#id_buy_orders_body').append(tr);
  }
  
  for (var i=0; i<orders.sell.length; i++)
  {
    const tr = $('<tr></tr>')
      .append($('<td>'+(orders.sell[i].price*1.0).toFixed(8)+'</td>'))
      .append($('<td>'+(orders.sell[i].price*orders.sell[i].amount*1.0).toFixed(8)+'</td>'))
      .append($('<td>'+(orders.sell[i].amount*1.0).toFixed(8)+'</td>'));
      
    $('#id_sell_orders_body').append(tr);
  }
  
  if (!orders.buy.length)
    orders.buy = [{price: 0.0}];
  if (!orders.sell.length)
    orders.sell = [{price: 0.0}];
    
  $('#id_max_bid').text((orders.buy[0].price*1.0).toFixed(8));
  $('#id_max_ask').text((orders.sell[0].price*1.0).toFixed(8));
  $('#id_max_bid_coin').text(utils.MAIN_COIN);
  $('#id_max_ask_coin').text(utils.MAIN_COIN);
  
}

function UpdateUserOrders(userOrders)
{
  $('#id_user_orders').empty();
  
  for (var i=0; i<userOrders.length; i++)
  {
    if (userOrders[i].coin != g_CurrentPair)
      continue;
      
    const orderID = userOrders[i].id;
    
    const close = $('<button type="button" class="btn btn-primary btn-sm">Close</button>').on('click', e => {
      $('#loader').show();
      $.post( "/closeorder", {orderID: orderID}, function( data ) {
        $('#loader').hide();
        if (data.result != true)
        {
          utils.alert_fail(data.message);
          return;
        }
        utils.alert_success('Your order is closed!');
        socket.send(JSON.stringify({request: 'getpair', message: [utils.MAIN_COIN, g_CurrentPair]}));
      }, "json" );
    });
    
    const typeColor = userOrders[i].buysell == 'sell' ? "text-danger" : "text-success";
    const tr = $('<tr></tr>')
      .append($('<td>'+utils.timeConverter(userOrders[i].time*1)+'</td>'))
      .append($('<td><p class="'+typeColor+'">'+userOrders[i].buysell+'</p></td>'))
      .append($('<td>'+userOrders[i].amount+' '+coinNameToTicker[userOrders[i].coin].ticker+'</td>'))
      .append($('<td>'+userOrders[i].price+" "+coinNameToTicker[utils.MAIN_COIN].ticker+'</td>'))
      .append($('<td></td>').append(close));
      
    $('#id_user_orders').append(tr);
  }
}

function UpdateBalance(message)
{
  var buyBalance = 0.0;
  var sellBalance = 0.0;
  
  if (message.coin && (message.balance != undefined))
  {
    if (message.coin.name == utils.MAIN_COIN)
    {
      $('#id_buy_balance').empty();
      buyBalance = message.balance;
      $('#id_buy_balance').text(buyBalance);
      $('#id_buy_coin').text(utils.MAIN_COIN);
    }
    if (message.coin.name == g_CurrentPair)
    {
      $('#id_sell_balance').empty();
      sellBalance = message.balance;
      $('#id_sell_balance').text(sellBalance);
      $('#id_sell_coin').text(g_CurrentPair);
    }
  }
}

$('#inputBuyAmount').on('change', e => {
  UpdateBuyComission();
})
$('#inputBuyPrice').on('change', e => {
  UpdateBuyComission();
})
$('#inputSellAmount').on('change', e => {
  UpdateSellComission();
})
$('#inputSellPrice').on('change', e => {
  UpdateSellComission();
})

function UpdateBuyComission()
{
  const amount = $('#inputBuyAmount').val() || 0;
  const price = $('#inputBuyPrice').val() || 0;
  const balance = $('#id_buy_balance').text() || 0;
  try 
  {
    const comission = utils.COMISSION*amount*price;
    const total = amount*price+comission;
    $('#inputBuyComission').val(comission.toFixed(7));
    $('#inputBuyTotal').val(total.toFixed(7));
  }
  catch(e) {}
}
function UpdateSellComission()
{
  const amount = $('#inputSellAmount').val() || 0;
  const price = $('#inputSellPrice').val() || 0;
  const balance = $('#id_sell_balance').text() || 0;
  try 
  {
    const comission = utils.COMISSION*amount*price;
    const total = amount*price+comission;
    $('#inputSellComission').val(comission.toFixed(7));
    $('#inputSellTotal').val(total.toFixed(7));
  }
  catch(e) {}
  
}

function drawChart()
{
  if (!chartData.length)
    return;
  
  var table = [];
  for (var i=0; i<chartData.length; i++)  
  {
    const time = utils.timeConverter(chartData[i].t10min*360000, true);
    //const time = new Date(chartData[i].t10min*360000);
    const timeStart = chartData[i].t10min;
    
    var min = chartData[i].avg_10min;
    var init = chartData[i].avg_10min;
    var final = chartData[i].avg_10min;
    var max = chartData[i].avg_10min;
    
    for (var j=i+1; j<chartData.length; j++)
    {
      if (chartData[j].t10min*1 > timeStart*1+10)
        break;
      
      if (chartData[j].avg_10min*1 < min)
        min = chartData[j].avg_10min;
      if (chartData[j].avg_10min*1 > max)
        max = chartData[j].avg_10min;
        
      final = chartData[j].avg_10min;
      i++;
    }
    
    table.push([time, min/1000000, init/1000000, final/1000000, max/1000000]);
  }
  
  if (!table.length)
    return;
    
  var data = google.visualization.arrayToDataTable(table, true);
  var options = {
      //title: g_CurrentPair,
      /*hAxis: {
        minValue: 0,
        maxValue: 24,
        ticks: [0, 4, 8, 12, 16, 20, 24]
      },*/
      legend: 'none'
  };
  
  var chart = new google.visualization.CandlestickChart(document.getElementById('chart_div'));
  chart.draw(data, options);
}
