/* BullRock - site estatico. JavaScript puro, sem dependencias.
   Tudo o que muda (Pix, datas, loja) vem de /config.json. */
(function () {
    'use strict';

    var corpo = document.body;
    var avisoEl = document.getElementById('aviso');
    var dialogo = document.getElementById('pixDialogo');
    var avisoTimer = null;
    var each = function (lista, fn) { Array.prototype.forEach.call(lista, fn); };

    /* ---------------- avisos, copia e compartilhamento ---------------- */

    function msg(chave, padrao) {
        return corpo.getAttribute('data-msg-' + chave) || padrao;
    }

    function avisar(texto) {
        if (!avisoEl) { return; }
        // Com a janela do PIX aberta, o aviso fica dentro dela (camada superior)
        var destino = (dialogo && dialogo.hasAttribute('open')) ? dialogo : document.body;
        if (avisoEl.parentNode !== destino) { destino.appendChild(avisoEl); }
        avisoEl.textContent = texto;
        avisoEl.classList.add('visivel');
        clearTimeout(avisoTimer);
        avisoTimer = setTimeout(function () { avisoEl.classList.remove('visivel'); }, 3200);
    }

    function copiarTexto(texto) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(texto);
        }
        return new Promise(function (resolve, reject) {
            var ta = document.createElement('textarea');
            ta.value = texto;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-1000px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            ta.setSelectionRange(0, texto.length);
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            document.body.removeChild(ta);
            if (ok) { resolve(); } else { reject(new Error('copy')); }
        });
    }

    function copiarComoFallback(dados) {
        var texto = dados.text ? dados.text + ' ' + dados.url : dados.url;
        return copiarTexto(texto).then(
            function () { avisar(msg('copiado', 'Link copiado')); },
            function () { avisar(msg('falha', 'Copie o endereco:') + ' ' + dados.url); }
        );
    }

    function compartilhar(dados) {
        if (navigator.share) {
            return navigator.share(dados).catch(function (erro) {
                if (erro && erro.name === 'AbortError') { return; } // usuario fechou
                return copiarComoFallback(dados);
            });
        }
        return copiarComoFallback(dados);
    }

    function ligarShare(raiz) {
        each(raiz.querySelectorAll('.js-share'), function (btn) {
            btn.addEventListener('click', function (ev) {
                // nao deixa o clique chegar a acao principal do botao
                ev.preventDefault();
                ev.stopPropagation();
                compartilhar({
                    title: btn.getAttribute('data-share-title') || document.title,
                    text: btn.getAttribute('data-share-text') || '',
                    url: btn.getAttribute('data-share-url') || location.href
                });
            });
        });
    }

    each(document.querySelectorAll('.js-copiar'), function (b) {
        b.addEventListener('click', function () {
            var valor = b.getAttribute('data-copiar') || '';
            copiarTexto(valor).then(
                function () { avisar(b.getAttribute('data-msg') || 'Copiado'); },
                function () { avisar(msg('falha', 'Copie manualmente:') + ' ' + valor); }
            );
        });
    });

    ligarShare(document);

    /* ---------------- Pix Copia e Cola (BR Code estatico) ---------------- */

    function tlv(id, valor) {
        var n = valor.length;
        return id + (n < 10 ? '0' : '') + n + valor;
    }

    function utf8(str) {
        if (window.TextEncoder) { return new TextEncoder().encode(str); }
        var s = unescape(encodeURIComponent(str)), out = [];
        for (var i = 0; i < s.length; i++) { out.push(s.charCodeAt(i)); }
        return out;
    }

    // CRC16-CCITT (polinomio 0x1021, inicial 0xFFFF), exigido pelo BR Code
    function crc16(str) {
        var bytes = utf8(str), crc = 0xFFFF;
        for (var i = 0; i < bytes.length; i++) {
            crc ^= bytes[i] << 8;
            for (var j = 0; j < 8; j++) {
                crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
            }
        }
        return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
    }

    function semAcento(s) {
        s = String(s || '');
        return (s.normalize ? s.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : s).trim();
    }

    function limitar(s, max) { return s.length > max ? s.substring(0, max) : s; }

    function brCodeValido(c) {
        if (typeof c !== 'string' || c.length < 30 || c.indexOf('000201') !== 0) { return false; }
        var p = c.length - 8;
        if (c.substr(p, 4) !== '6304') { return false; }
        return crc16(c.substring(0, p + 4)) === c.substr(p + 4).toUpperCase();
    }

    function campo(dados, id) {
        var i = 0;
        while (i + 4 <= dados.length) {
            var tag = dados.substr(i, 2), tam = parseInt(dados.substr(i + 2, 2), 10);
            if (isNaN(tam) || i + 4 + tam > dados.length) { break; }
            if (tag === id) { return dados.substr(i + 4, tam); }
            i += 4 + tam;
        }
        return '';
    }

    function gerarBrCode(p) {
        var nome = limitar(semAcento(p.favorecido), 25);
        var cidade = limitar(semAcento(p.cidade).toUpperCase(), 15);
        var txid = semAcento(p.identificador || 'BULLROCK').replace(/[^A-Za-z0-9]/g, '');
        txid = txid ? limitar(txid, 25) : '***';

        var conta = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', String(p.chave).trim());
        var mensagem = semAcento(p.mensagem);
        var espaco = 99 - conta.length - 4;
        if (mensagem && espaco > 0) { conta += tlv('02', limitar(mensagem, espaco)); }

        var s = tlv('00', '01') + tlv('26', conta) + tlv('52', '0000') + tlv('53', '986');
        var v = parseFloat(String(p.valor || '').replace(',', '.'));
        if (v > 0) { s += tlv('54', v.toFixed(2)); }
        s += tlv('58', 'BR') + tlv('59', nome) + tlv('60', cidade) + tlv('62', tlv('05', txid)) + '6304';
        return s + crc16(s);
    }

    /* ---------------- datas (sempre no horario de Brasilia) ---------------- */

    function hojeBrasilia() {
        try {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
            }).format(new Date());                                   // AAAA-MM-DD
        } catch (e) {
            var d = new Date();
            return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
        }
    }

    // aceita "dd/mm/aaaa" ou "aaaa-mm-dd"; devolve "aaaa-mm-dd" ou null
    function normalizarData(s) {
        var txt = String(s || '').trim();
        var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(txt);
        var a, mes, dia;
        if (m) { dia = +m[1]; mes = +m[2]; a = +m[3]; }
        else {
            m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(txt);
            if (!m) { return null; }
            a = +m[1]; mes = +m[2]; dia = +m[3];
        }
        var d = new Date(Date.UTC(a, mes - 1, dia));
        if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) { return null; }
        return a + '-' + ('0' + mes).slice(-2) + '-' + ('0' + dia).slice(-2);
    }

    function pixNoPeriodo(periodos, hoje) {
        if (!Array.isArray(periodos)) { return false; }
        for (var i = 0; i < periodos.length; i++) {
            var p = periodos[i] || {};
            var ini = normalizarData(p.inicio), fim = normalizarData(p.fim);
            if (!ini || !fim || fim < ini) { continue; }              // periodo invalido: ignora
            if (hoje >= ini && hoje <= fim) { return true; }          // inicio e fim inclusivos
        }
        return false;
    }

    function urlValida(u) { return typeof u === 'string' && /^https:\/\//i.test(u.trim()); }

    /* ---------------- janela do Pix ---------------- */

    function abrirPix() {
        if (!dialogo) { return; }
        if (typeof dialogo.showModal === 'function') { dialogo.showModal(); }
        else { dialogo.setAttribute('open', ''); dialogo.classList.add('sem-suporte'); }
    }

    function fecharPix() {
        if (!dialogo) { return; }
        if (typeof dialogo.close === 'function') { dialogo.close(); } else { dialogo.removeAttribute('open'); }
        if (location.hash === '#apoie' && history.replaceState) {
            history.replaceState(null, '', location.pathname + location.search);
        }
    }

    if (dialogo) {
        each(dialogo.querySelectorAll('.js-pix-fechar'), function (b) { b.addEventListener('click', fecharPix); });
        dialogo.addEventListener('click', function (ev) { if (ev.target === dialogo) { fecharPix(); } });
    }

    function mostrar(el, texto) {
        if (!el) { return; }
        if (texto) { el.textContent = texto; el.hidden = false; } else { el.hidden = true; }
    }

    function preencherDialogo(pix, codigo, chave) {
        if (!dialogo) { return; }
        var favorecido = String(pix.favorecido || '').trim() || (codigo ? campo(codigo, '59') : '');
        var rotuloFav = favorecido ? 'Favorecido: ' + favorecido : '';
        var modoCodigo = dialogo.querySelector('.js-modo-codigo');
        var modoChave = dialogo.querySelector('.js-modo-chave');

        if (codigo) {
            modoCodigo.hidden = false;
            modoChave.hidden = true;
            modoCodigo.querySelector('.js-pix-codigo').setAttribute('data-copiar', codigo);
            var v = parseFloat(campo(codigo, '54'));
            mostrar(modoCodigo.querySelector('.js-pix-valor'),
                v > 0 ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '');
            mostrar(modoCodigo.querySelector('.js-pix-favorecido'), rotuloFav);
            var alt = modoCodigo.querySelector('.js-pix-alternativa');
            alt.hidden = !chave;
            alt.querySelector('.js-pix-chave').setAttribute('data-copiar', chave);
        } else {
            modoCodigo.hidden = true;
            modoChave.hidden = false;
            modoChave.querySelector('.js-pix-chave-texto').textContent = chave;
            modoChave.querySelector('.js-pix-chave').setAttribute('data-copiar', chave);
            mostrar(modoChave.querySelector('.js-pix-favorecido'), rotuloFav);
        }
    }

    /* ---------------- aplica o config.json ---------------- */

    function aplicarLoja(url) {
        var atual = document.getElementById('loja'), tpl = document.getElementById('tplLoja');
        if (!urlValida(url) || !atual || !tpl) { return; }
        var novo = tpl.content.firstElementChild.cloneNode(true);
        novo.querySelector('.js-loja-link').href = url.trim();
        novo.querySelector('.js-share').setAttribute('data-share-url', url.trim());
        atual.parentNode.replaceChild(novo, atual);
        ligarShare(novo);
    }

    function aplicarPix(pix, periodos) {
        pix = pix || {};
        var slot = document.getElementById('pixSlot'), tpl = document.getElementById('tplPix');
        if (!slot || !tpl) { return; }

        var url = urlValida(pix.url) ? pix.url.trim() : '';
        var codigo = '';
        if (!url) {
            var colado = String(pix.copiaECola || '').trim();
            if (colado) { codigo = brCodeValido(colado) ? colado : ''; }
            else if (pix.chave && pix.favorecido && pix.cidade) {
                try { codigo = gerarBrCode(pix); } catch (e) { codigo = ''; }
            }
        }
        var chave = String(pix.chave || '').trim() || (codigo ? campo(campo(codigo, '26'), '01') : '');
        if (!url && !codigo && !chave) { return; }                    // nada configurado
        if (!pixNoPeriodo(periodos, hojeBrasilia())) { return; }       // fora do periodo

        var bloco = tpl.content.firstElementChild.cloneNode(true);
        var corpoPix = bloco.querySelector('.js-pix-corpo');
        if (url) {
            corpoPix.href = url;
            corpoPix.target = '_blank';
            corpoPix.rel = 'noopener';
            bloco.querySelector('.js-share').setAttribute('data-share-url', url);
        } else {
            corpoPix.addEventListener('click', function (ev) { ev.preventDefault(); abrirPix(); });
            preencherDialogo(pix, codigo, chave);
        }
        slot.parentNode.replaceChild(bloco, slot);
        ligarShare(bloco);

        if (!url && location.hash === '#apoie') { abrirPix(); }
    }

    function carregarConfig() {
        if (!window.fetch) { return; }
        fetch('/config.json', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (cfg) {
                if (!cfg) { return; }
                try { aplicarLoja(cfg.lojaUrl); } catch (e) { /* segue sem loja */ }
                try { aplicarPix(cfg.pix, cfg.pixPeriodos); } catch (e) { /* seguro: sem Pix */ }
            })
            .catch(function () { /* config ausente ou com erro: Pix oculto */ });
    }

    /* ---------------- logo: se a imagem falhar, mostra o letreiro ---------------- */

    function trocarLogoPorLetreiro(img) {
        if (!img || !img.parentNode) { return; }
        var span = document.createElement('span');
        span.className = 'logo-letreiro';
        span.textContent = 'BullRock';
        img.parentNode.replaceChild(span, img);
    }

    var logo = document.querySelector('.logo-img');
    if (logo) {
        if (logo.complete && logo.naturalWidth === 0) { trocarLogoPorLetreiro(logo); }
        else { logo.addEventListener('error', function () { trocarLogoPorLetreiro(logo); }); }
    }

    carregarConfig();
})();
