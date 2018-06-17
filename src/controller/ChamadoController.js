	
var moment = require('moment');
var Promise = require('promise');
var q = require('q');
var classificadorStatus = require('../util/ClassificadorStatusChamado');

/*Controller para gerar as notificações a medida que as acoes no chamado forem ocorrendo*/
var NotificacaoModel = require('../models/NotificacaoModel');
var RegiaoModel = require('../models/RegiaoModel');
var UnidadeModel = require('../models/UnidadeModel');
var SolicitanteAutorizadoModel = require('../models/SolicitanteAutorizadoModel');
var NotificacaoController = require('../controller/NotificacaoController')(NotificacaoModel);

var chamadoController = function(chamadoModel, grupoModel){

	var salvarNovo = function(req, res){
		console.log(' ::: Salvar Novo ');
		var chamado = new chamadoModel(req.body);
		
		console.log(chamado);
		var msgObrigatorio = '';
		// CAMPOS OBRIGATORIOS: dono, idSolicitante, idCategoria, idUnidade
		if(!req.body.dono) {
			msgObrigatorio+= 'Dono é obrigatório.<br/>';
		}
		if(!req.body.idSolicitante && !req.body.cpfSolicitante) {
			msgObrigatorio+= 'Solicitante é obrigatório.<br/>';
		}
		if(!req.body.idCategoria) {
			msgObrigatorio+= 'Categoria do chamado é obrigatória.<br/>';
		}
		if(!req.body.idUnidade) {
			msgObrigatorio+= 'A unidade de origem do chamado é obrigatória.<br/>';
		}
		
		if(msgObrigatorio != '') {
			res.status(400);
			res.send(msgObrigatorio);
		} else {
			chamado.dataCriacao = moment().second(0).millisecond(0).utc().format();


			// REGRA VALIDACAO 1: não é permitido um solicitante abrir um novo chamado para a mesma unidade, desde que esse chamado ainda esteja aberto. 
			var recuperarChamadoAbertoParaEsseSolicitanteEUnidade = function() {
			  	var deferred = q.defer();

			   	chamadoModel.where({ 'dono': chamado.dono , 'idUnidade': chamado.idUnidade, 'idSolicitante': chamado.idSolicitante, 'deletado': false, 'dataFim': null})
			   			.count(function (err, count) {
					console.log('callback do count recuperarChamadoAbertoParaEsseSolicitanteEUnidade :', count );
					if(!err){
				  		deferred.resolve(count);
					}
				});

			  	return deferred.promise;
			};
			
			// REGRA VALIDACAO 1: (para autorizados) não é permitido um solicitante AUTORIZADO abrir um novo chamado para a mesma unidade, desde que esse chamado ainda esteja aberto. 
			var recuperarChamadoAbertoParaEsseSolicitanteAutorizadoEUnidade = function() {
			  	var deferred = q.defer();

			   	chamadoModel.where({ 'dono': chamado.dono , 'idUnidade': chamado.idUnidade, 'cpfSolicitante': chamado.cpfSolicitante, 'deletado': false, 'dataFim': null})
			   		.count(function (err, count) {
						console.log('callback do count recuperarChamadoAbertoParaEsseSolicitanteAutorizadoEUnidade :', count );
						if(!err){
					  		deferred.resolve(count);
						}
					});

			  	return deferred.promise;
			};

			// CASO O CHAMADO SEJA PROVENIENTE DE UM SOLICITANTE AUTORIZADO DEVE VALIDAR NO CADASTRO SE ELE REALMENTE ESTÀ AUTORIZADO
			var validarSolicitanteAutorizado = function() {
			  	var deferred = q.defer();

			  	var query = [];
				query.push({dono : chamado.dono});
				query.push({cpf :  chamado.cpfSolicitante});

			   	SolicitanteAutorizadoModel.find(query)
			   		.exec(function (err, solicitante) {
						console.log('callback do validarSolicitanteAutorizado :', solicitante );
						if(!err && solicitante){
					  		deferred.resolve(solicitante);
						} 
					});

			  	return deferred.promise;
			};


			var recuperarRegiaoBackupPorId = function(idRegiao) {
			  	var deferred = q.defer();

			   	RegiaoModel.findById(idRegiao)
			   	.populate('empresa')
			   	.exec(function(err, regiao){
					if(err){
						res.status(500).send(err);
					} else {
						listarQtdChamadosEmAndamentoDaRegiao(idRegiao).then(function(total){
							if(total <= 0 || total < regiao[0].apoios.length){
								deferred.resolve(regiao);
							} else {
								deferred.resolve(null);
							}
						});
					}
				});

			  	return deferred.promise;
			};


			var listarQtdChamadosEmAndamentoDaRegiao = function(idRegiao){
				var deferred = q.defer();

				var query = [];
				
				query.push({idRegiao : idRegiao});
				query.push({deletado : false});
				query.push({dataFim :  null});
				
				var queryFinal = { $and: query };
				
				chamadoModel.where(queryFinal).count(function(err, count){
					if(err){
						res.status(500).send(err);
					} else {
						deferred.resolve(count);
					}
				});

				return deferred.promise;
			};


			/*var recuperarUnidadeDoChamado = function() {
			  	var deferred = q.defer();

			  	//console.log('Vai pesquisar pela unidade : ', chamado.idUnidade)
			   	UnidadeModel.findById(chamado.idUnidade).
			   	populate("idAgrupamento")
			   	.exec(function(err, unidade){
			   		console.log('chegou no log do promise de recuperar a unidade da unidade: ', unidade);
					if(err){
						res.status(500).send(err);
					} else {
						deferred.resolve(unidade);
					}
				});

			  	return deferred.promise;
			};*/

			var recuperarRegiaoDaUnidade = function() {
			  	var deferred = q.defer();

			  	//console.log('Vai pesquisar pela unidade : ', chamado.idUnidade)
			   	grupoModel.find({ unidades : { $all : [chamado.idUnidade] }})
			   	.populate('empresa')
			   	.exec(function(err, regiao){
			   		//console.log('chegou no log do promise de recuperar a regiao da unidade: ', regiao);
					if(err){
						res.status(500).send(err);
					} else {
						deferred.resolve(regiao);
					}
				});

			  	return deferred.promise;
			};


			// Após o chamado aberto eh necessário criar uma notificação para todos os apoios daquela região
			var gerarNotificacoesParaAtendentes = function(chamado){

				RegiaoModel.findById(chamado.idRegiao)
					.populate('apoios')
					.exec(function(err, regiao){
						if(!err){
							if(regiao.apoios){
								console.log('Apoios que serão notificados : ',regiao.apoios);
								for(var i = 0 ; i< regiao.apoios.length ; i++){
									var notif = new NotificacaoModel();
									notif.dono = chamado.dono;
									notif.idPessoa = regiao.apoios[i]._id;
									notif.idChamado = chamado._id;
									notif.msg = "Olá "+regiao.apoios[i].nome+". Foi aberto um novo chamado. Sala: "+chamado.nomeUnidade+"."

									NotificacaoController.salvarNovoSimples(notif);
								}
							}
						}
					});

			};


			// Após as validações de usuario solicitante esse método eh chamado
			var validarRegiaoEAbrirChamado = function(){
				recuperarRegiaoDaUnidade().then(function(regiao){

					if(regiao){
						var criarChamado = function(){
							console.log("vou setar a regiao",regiao[0]._id);
							chamado.idEmpresa = regiao[0].empresa._id
							if(!chamado.codigo){
								chamado.codigo = Math.floor(Math.random() * 99999999);
							}
							chamado.idRegiao = regiao[0]._id;
							chamado.nomeRegiao = regiao[0].nome;

							chamado.save();

							// Varrer todos os atendentes da região e gerar uma notificação
							gerarNotificacoesParaAtendentes(chamado);
				
							res.status(201);
							res.send(chamado);
						}

						// vai recuperar o total de chamdos abertos .. se não tiver atendentes livres vai verificar 
						// na regiao de backup. caso exista atendente livre o chamado eh aberto para a regiao de backup
						listarQtdChamadosEmAndamentoDaRegiao(regiao[0]._id).then(function(totalChamadosDestaRegiao){
							if(regiao[0].idRegiaoBackup && totalChamadosDestaRegiao > 0 && totalChamadosDestaRegiao >= regiao[0].apoios.length){
								console.log("Entrou na parada para recuperar o chamado de backup ",regiao[0].idRegiaoBackup);
								recuperarRegiaoBackupPorId(regiao[0].idRegiaoBackup).then(function(regiaoBackup){
									console.log('regiao de backup recuperada : ', regiaoBackup);
									if(regiaoBackup){
										console.log('vai gerar para a regiao de backup  ');
										chamado.idEmpresa = regiaoBackup.empresa._id
										if(!chamado.codigo){
											chamado.codigo = Math.floor(Math.random() * 99999999);
										}
										chamado.idRegiao = regiaoBackup._id;
										chamado.nomeRegiao = regiaoBackup.nome;

										chamado.save();

										// Varrer todos os atendentes da região e gerar uma notificação
										gerarNotificacoesParaAtendentes(chamado);
							
										res.status(201);
										res.send(chamado);
									} else {
										criarChamado();
									}
								});

							} else {
								criarChamado();
							}
						});
					} else {
						res.status(403);
						res.end('Essa unidade não está cadastrada para receber atendimento. Favor contactar o apoio via telefone..');
					}		
				});
			};
					


			// INICIAR o processo de validação e abertura do chamado
			if(chamado.cpfSolicitante){
				// SE FOR UM CHAMADO DE UM ALGUEM AUTORIZADO
				console.log("INFO : VAI ABRI UM CHAMADO PARA UM SOLICITANTE AUTORIZADO");
				
				validarSolicitanteAutorizado().then(function(solicitante){
					if(solicitante) {
						recuperarChamadoAbertoParaEsseSolicitanteAutorizadoEUnidade().then(function(total) {
							if(!total || total == 0){
								//recuperarUnidadeDoChamado().then(function(unidade){
								//	chamado.
								// });
								
								validarRegiaoEAbrirChamado();
							} else {
								res.status(403);
								res.end('Já existe um chamado aberto deste solicitante para essa unidade.');
							}
						});
					} else {
						res.status(403);
						res.end('Usuário não autorizado');
					}
				});
				
			} else { 
				
				// SE FOR UM CHAMADO DE UM PROFESSOR CADASTRADO
				console.log("INFO : VAI ABRI UM CHAMADO PARA UM PROFESSOR LOGADO");
				recuperarChamadoAbertoParaEsseSolicitanteEUnidade().then(function(total) {
					if(!total || total == 0){
						validarRegiaoEAbrirChamado();
					} else {
						res.status(403);
						res.end('Já existe um chamado aberto deste solicitante para essa unidade.');
					}
				});
			}

		}

	};


	var atualizar = function(req, res){
		console.log(' ::: Atualizar chamado ');
		if(req.body._id){
			delete req.body._id;
		}

		for(var p in req.body){
			req.chamado[p] = req.body[p];	
		}
		
		console.log(req.chamado);
		req.chamado.save(function(err){
			console.log('call back atualizacao chamado');
			if(err){
				res.status(500).send(err);
			} else {
				console.log('vai retornar 201 - atualizacao chamado');
				res.status(201).send();
			}
		});
	};


	// esse metodo se chamava AVALIAR.. agora se chama classificar. É usado para que o apoio classifique o
	// chamado após finalizar
	var classificarAtendimento = function(idChamado, req, res){
		console.log(' ::: classificar chamado ');
		if(req.body._id){
			delete req.body._id;
		}

		console.log("idCategoria : ",req.body.idCategoria);
		console.log("nomeCategoria : ",req.body.nomeCategoria);
		console.log('item: ',req.body.idItem);
		console.log('comentarioEncerramento: ',req.body.comentarioEncerramento);

		if(!req.body.idItem){
			res.status(403).end("É necessário informa um item para completar a classificação");
		} else {

			chamadoModel.findById(idChamado, function(err, chamado){
				console.log("vai classificar esse chamado", chamado);
				if(err){
					res.status(500).send(err);
				} else if(chamado) {
					
					if(req.body.idCategoria){
						chamado.idCategoria = req.body.idCategoria;	
					}

					if(req.body.nomeCategoria){
						chamado.nomeCategoria = req.body.nomeCategoria;	
					}

					console.log('item: ',req.body.idItem);
					chamado.itens = [req.body.idItem];	
					
					chamado.save(function(err){
						console.log('call back atualizacao chamado');
						if(err){
							res.status(500).send(err);
						} else {
							console.log('vai retornar 201 - avaliado chamado');
							res.status(201).send("OK");
						}
					});

				} else {
					res.status(404).send('Chamado não encontrado');
				}
			});
		}	
	
	};


	// avaliação feita pelo solicitando após a finalização do chamado.
	var avaliarAtendimento = function(idChamado, numeroEstrelas, req, res){
		console.log(' ::: avaliar chamado ');
		if(req.body._id){
			delete req.body._id;
		}

		chamadoModel.findById(idChamado, function(err, chamado){
			console.log("vai avaliar esse chamado", chamado);
			if(err){
				res.status(500).send(err);
			} else if(chamado) {
				if(!chamado.avaliacaoAtendimento){
					
					chamado.avaliacaoAtendimento = numeroEstrelas;	
				
					chamado.save(function(err){
						console.log('call back avalicao chamado');
						if(err){
							res.status(500).send(err);
						} else {
							console.log('vai retornar 201 - avaliado chamado');
							res.status(201).send("OK");
						}
					});
				}
			} else {
				res.status(404).send('Chamado não encontrado');
			}
		});
	};


	var pegarAtendimento = function(idChamado, idAtendente, nomeAtendente, previsaoMinutos, req, res){
		console.log(' ::: pegar atendimento chamado ');
		if(!idChamado || !idAtendente){
			res.status(403).end("ID do chamado e ID do atentente são obrigatórios para iniciar um atendimento.");
		} else {
			chamadoModel.findById(idChamado, function(err, chamado){
				if(err){
					res.status(500).send(err);
				} else if(chamado) {
					console.log(chamado);
					
						if(chamado.dataApoio){
							res.status(403).send('Chamado já está atribuido a um atendente');
						} else {
							chamado.dataApoio =  moment().second(0).millisecond(0).utc().format();
							chamado.idAtendente = idAtendente;
							chamado.nomeAtendente = nomeAtendente;
							if(previsaoMinutos){
								chamado.previsaoChegada = previsaoMinutos;	
							} else {
								chamado.previsaoChegada = '5';
							}

							var dataCriacao = moment(chamado.dataCriacao); 
							var minutosAteAtribuicao = moment().second(0).millisecond(0).utc().diff(dataCriacao, 'minutes');
							chamado.minutosAteAtribuicao = minutosAteAtribuicao;

							chamado.save(function(err){
								if(err){
									res.status(500).send(err);
								} else {

									// 	salva notificação para o solicitante saber que o chamado será atendido.
									var notif = new NotificacaoModel();
									notif.dono = chamado.dono;
									notif.idPessoa = chamado.idSolicitante;
									notif.idChamado = chamado._id;
									notif.msg = "Olá "+chamado.nomeSolicitante+". O atendente "+nomeAtendente+" está a caminho.";

									NotificacaoController.salvarNovoSimples(notif);

									// retorna ok para chamador
									console.log('vai retornar 201 - chamado em atendimento');
									res.status(201).send("OK");
								}
							});
						}

				} else {
					res.status(404).send('Chamado não encontrado');
				}
			});
		}

		
	};


	var iniciarAtendimento = function(idChamado, idAtende, req, res){
		console.log(' ::: Iniciar atendimento chamado ');
		if(!idChamado || !idAtende){
			res.status(403).end("ID do chamado e ID do atentente são obrigatórios para iniciar um atendimento.");
		} else {
			

			var validarAtendenteJaPussuiChamadoEmAndamento = function() {
			  	var deferred = q.defer();

			  	var query = [];

				query.push({deletado : false});
				query.push({dataFim :  null});
				query.push({dataInicioAtendimento :  {$ne: null }});
				query.push({idAtendente :  idAtende});
				
				var queryFinal = { $and: query };

			  	chamadoModel.find(queryFinal).count().exec(
			  		function(err, count){
					if(!err){
						console.log('chamados em andamento encontrados para esse pessoa: ',count);
				  		deferred.resolve(count);
					} 
				});

			  	return deferred.promise;
			};


			var iniciar = function(){
				chamadoModel.findById(idChamado, function(err, chamado){
					if(err){
						res.status(500).send(err);
					} else if(chamado) {
						
							if(chamado.dataInicioAtendimento){
								res.status(403).send('Chamado já está em atendimento');
							} else if(chamado.idAtendente != idAtende){
								res.status(403).send('Chamado está atribuido a outro atendente. Por isso você não pode iniciar esse chamado.');
							} else {
								
								var dataApoio = moment(chamado.dataApoio);
								chamado.dataInicioAtendimento =  moment().second(0).millisecond(0).utc().format();;

								var minutosAteInicio = moment().second(0).millisecond(0).utc().diff(dataApoio, 'minutes');
								chamado.minutosDaAtribuicaoAteInicio = minutosAteInicio;

								chamado.save(function(err){
									if(err){
										res.status(500).send(err);
									} else {

										console.log('vai retornar 201 - chamado em atendimento');
										res.status(201).send("OK");
									}
								});
							}

					} else {
						res.status(404).send('Chamado não encontrado');
					}
				});
			};


			validarAtendenteJaPussuiChamadoEmAndamento().then(function(total) {
 				//console.log('recuperou o total por pessoa');
 				if(total > 0){
					console.log("Você já possui um chamado em andamento.");
					res.status(403);
					res.end('Você já possui um chamado em andamento.');
				} else {
					iniciar();
				}
 			});

			
		}
	};


	var finalizarAtendimento = function(idChamado, req, res){
		console.log(' ::: Finalizar atendimento chamado ');

		chamadoModel.findById(idChamado, function(err, chamado){
			if(err){
				res.status(500).send(err);
			} else if(chamado) {
				
				if(chamado.dataFim){
					res.status(403).send('Chamado já foi finalizado anteriormente');
				} else {
					chamado.dataFim =  moment().second(0).millisecond(0).utc().format();
					var dtInicio = moment(chamado.dataInicioAtendimento); 
					var minutosAteFim = moment().second(0).millisecond(0).utc().diff(dtInicio, 'minutes');
					chamado.minutosDoInicioAteFinalizacao = minutosAteFim;

					chamado.save(function(err){
						if(err){
							res.status(500).send(err);
						} else {

						// 	salva notificação para o solicitante saber que o chamado foi fechado.
							var notif = new NotificacaoModel();
							notif.dono = chamado.dono;
							if(chamado.idSolicitante){
								notif.idPessoa = chamado.idSolicitante;	
							} else {
								notif.idPessoa = chamado.cpfSolicitante;
							}
							
							notif.idChamado = chamado._id;
							notif.msg = "Olá "+chamado.nomeSolicitante+". O chamado "+chamado.codigo+" foi fechado pelo atendente. Acesse a listagem de chamdos encerrados e avalie o atendimento.";

							NotificacaoController.salvarNovoSimples(notif);

							console.log('vai retornar 201 - chamado finalizado');
							res.status(201).send("OK");
						}
					});
				}

			} else {
				res.status(404).send('Chamado não encontrado');
			}
		});
	};



	var remover = function(req, res){
		console.log(' ::: Remover Chamado');

		req.chamado.remove(function(err){
			if(err){
				res.status(500).send(err);
			} else {
				res.status(204).send('Chamado removido.');
			}
		});	
	
	};


	var removerLogico = function(idChamado, req, res){
		console.log(' ::: Remover Logico Chamado');

		chamadoModel.findById(idChamado, function(err, chamado){
			if(err){
				res.status(500).send(err);
			} else if(chamado) {
				if(req.chamado.dataApoio){
					res.status(403).end("Chamado em atendimento. Não é possível removê-lo.");
				} else {
					chamado.deletado = true;
					
					chamado.save(function(err){
						if(err){
							res.status(500).send(err);
						} else {
							console.log('vai retornar 201 - chamado deletado logicamente');
							res.status(201).send("OK");
						}
					});
				}

			} else {
				res.status(404).send('Chamado não encontrado');
			}
		});
	
	};


	var listar = function(req, res){
		console.log(' ::: Listar Chamados');
		var query = [];
		//console.log(moment().format()); 	
		if(req.query){
			//query = req.query;
			if(req.query.dataCriacao){
				query.push({dataCriacao : moment(query.dataCriacao, "DD/MM/YYYY").format()});
			} 
			if(req.query.dataFim){
				query.push({dataFim : moment(query.dataFim, "DD/MM/YYYY").format()});
			}

			if(req.query.dataCriacaoDe && query.dataCriacaoAte){
				query.push({
                    $gte: moment(query.dataCriacaoDe, "DD/MM/YYYY").hour(0).minute(0).second(0).millisecond(0).format(),
                    $lte: moment(query.dataCriacaoAte, "DD/MM/YYYY").hour(23).minute(59).second(59).millisecond(999).format()
                });
			}

			if(req.query.dataFimDe && query.dataFimAte){
				query.push({
                    $gte: moment(query.dataFimDe, "DD/MM/YYYY").hour(0).minute(0).second(0).millisecond(0).format(),
                    $lte: moment(query.dataFimAte, "DD/MM/YYYY").hour(23).minute(59).second(59).millisecond(999).format()
                });
			}


			if(req.query.idEmpresa){
				query.push({idEmpresa : req.query.idEmpresa});
			}

			if(req.query.deletado){
				query.push({deletado : req.query.deletado});
			}
			
			if(req.query.idCategoria){
				query.push({idCategoria : req.query.idCategoria});
			}	
			
			if(req.query.idRegiao){
				query.push({idRegiao : req.query.idRegiao});
			}	

			if(req.query.idSolicitante){
				query.push({idSolicitante : req.query.idSolicitante});
			}

			if(req.query.nomeSolicitante){
				query.push({nomeSolicitante : RegExp(req.query.nomeSolicitante, "i") });
			}
		}

		console.log(query);
		var queryFinal = {};
		if(query && query.length > 0){
			queryFinal = { $and: query };
		}

		chamadoModel.find(queryFinal)
			.populate('itens').populate('idUnidade') 
			.exec(function(err, chamados){

				if(err){
					res.status(500).send(err);
				} else {
					
					var returnChamados = [];
					chamados.forEach(function(element, index, array){
						var chamadoObj = element.toJSON();
						chamadoObj.status = classificadorStatus(chamadoObj);
						returnChamados.push(chamadoObj);
					});

					//console.log(returnEventos);
					res.json(returnChamados);
				}
			});
	};


	/*
	* indAbertos = 1 mostra apenas os abertos
	* indAbertos = 0 mostra apenas os fechados
	*/
	var listarChamadosPorSolicitante = function(idSolicit, indAbertos, req, res){
		console.log(' ::: Listar Chamados abertos por solicitante');
		var query = [];
		
		query.push({idSolicitante : idSolicit});
		query.push({deletado : false});

		if(indAbertos == 1){
			query.push({dataFim :  null});
		} else {
			query.push({dataFim :  { $ne: null }});
		}
		
		var queryFinal = {};
		if(query && query.length > 0){
			queryFinal = { $and: query };
		}

		console.log(queryFinal);

		chamadoModel.find(queryFinal)
		.populate("idUnidade").populate("idCategoria")
		.exec(function(err, chamados){
			if(err){
				res.status(500).send(err);
			} else {
				

				var returnChamados = [];
				chamados.forEach(function(element, index, array){
					var chamadoObj = element.toJSON();
					chamadoObj.status = classificadorStatus(chamadoObj);
					returnChamados.push(chamadoObj);
				});

				//console.log(returnEventos);
				res.json(returnChamados);
			}
		});
	};


	var listarChamadosAbertos = function(donoParam, idEmpresa, req, res){
		console.log(' ::: Listar Chamados abertos por dono/empresa');
		var query = [];
		
		query.push({dono : donoParam});
		/*if(idEmpresaParam){
			query.push({idEmpresa : idEmpresaParam});
		}*/
		query.push({deletado : false});
		query.push({dataFim :  null});
		
		
		var queryFinal = {};
		if(query && query.length > 0){
			queryFinal = { $and: query };
		}

		console.log(queryFinal);

		chamadoModel.find(queryFinal)
		.populate("idUnidade").populate("idCategoria")
		.exec(function(err, chamados){
			if(err){
				res.status(500).send(err);
			} else {

				var returnChamados = [];
				chamados.forEach(function(element, index, array){
					var chamadoObj = element.toJSON();
					chamadoObj.status = classificadorStatus(chamadoObj);
					returnChamados.push(chamadoObj);
				});

				//console.log(returnEventos);
				res.json(returnChamados);

			}
		});
	};


	var listarChamadosAbertosPorRegiaoDoAtendente = function(idAtendente,  req, res){
		console.log(' ::: Listar Chamados abertos por regiao do atendimento');


		var recuperarRegiaoDoAtendente = function() {
		  	var deferred = q.defer();

			RegiaoModel.find({apoios : idAtendente},  function(err, regioes){
				if(err){
					res.status(500).send(err);
				} else {
					deferred.resolve(regioes);
				}
			});

			return deferred.promise;
		};


			
		recuperarRegiaoDoAtendente().then(function(regioes) {
			if(regioes){
				var regiaoIn = [];
				for(var i = 0 ; i< regioes.length ; i++){
					regiaoIn.push(regioes[i]._id);
				}

				console.log(regiaoIn);

				var query = [];
		
				query.push({deletado : false});
				query.push({dataFim :  null});
				query.push({dataApoio :  null});
				query.push({dataInicioAtendimento :  null});
				query.push({idRegiao  : { $in : regiaoIn }});
			
				
				var queryFinal = { $and: query };

				console.log(queryFinal);

				chamadoModel.find( queryFinal , function(err, chamados){
					if(err){
						res.status(500).send(err);
					} else {
						console.log(chamados);
						res.json(chamados);
					}
				});
			}
		});
	};


	var listarChamadoEmAtendimento = function(idAtende, req, res){
		console.log(' ::: Listar Chamados abertos em atendimento por atendente');

		var query = [];

		query.push({deletado : false});
		query.push({dataFim :  null});
		query.push({idAtendente :  idAtende});
		
		
		var queryFinal = { $and: query };

		console.log(queryFinal);

		chamadoModel.find( queryFinal , function(err, chamados){
			if(err){
				res.status(500).send(err);
			} else {
				console.log(chamados);
				var returnChamados = [];
				chamados.forEach(function(element, index, array){
					var chamadoObj = element.toJSON();
					chamadoObj.status = classificadorStatus(chamadoObj);
					returnChamados.push(chamadoObj);
				});

				//console.log(returnEventos);
				res.json(returnChamados);
			}
		});
	};


	var listarMediaTemposChamados = function(dono, req, res){
		console.log('entrou na listagem de media de tempos');
		chamadoModel.aggregate(
	    [	{
	            "$match": {
	                dono: dono
	            }
        	},
			{ "$group": { 
		        "_id": {empresa: "$idEmpresa"},
		        "minutosAteAtribuir" : {$sum : "$minutosAteAtribuicao"},
		        "minutosAteIniciar" : {$sum : "$minutosDaAtribuicaoAteInicio"},
		        "minutosAteFichar" : {$sum : "$minutosDoInicioAteFinalizacao"},
	            "total": {$sum: 1}
			}}
	    ],
	    function(err,result) {
	    	console.log(result);
	    	res.status(201);
			res.send(result);
	       // Result is an array of documents
	    }
		);
	};



	var listarResumoQtdChamadosUltimos = function(dono, req, res){
		console.log('entrou na listagem de qtd ultimos dias');
		chamadoModel.aggregate(
	    [	
	    	{
	           "$match": {
	                dono: dono
	            }
        	},
			{ "$group": { 
		        "_id": 
	             {
	               	ano: {$year: "$dataCriacao"},
	               	mes: {$month: "$dataCriacao"},
	               	dia: {$dayOfMonth: "$dataCriacao"}
	             }, 
	             "total": {$sum: 1}
			}}
			//,
	        // Sorting pipeline
	        ,{ "$sort": {  "_id.ano": -1 , "_id.mes": -1 , "_id.dia": 1 } }
	        // Optionally limit results
	        ,{ "$limit": 15 }
	    ],
	    function(err,result) {
	    	console.log(result);
	    	res.status(201);
			res.send(result);
	    }
		);
	};


	var listarResumoMediaAvaliacoesChamados = function(dono, req, res){
		console.log('entrou na listarResumoMediaAvaliacoesChamados');
		chamadoModel.aggregate(
	    [	
	    	{
	           "$match": {
	                dono: dono
	            }
        	},
			{ 
				"$group": { 
		       	"_id": {empresa: "$idEmpresa"},
		        "mediaAvaliacaoAtendimento" : {$avg : "$avaliacaoAtendimento"}
			}}
	    ],
	    function(err,result) {
	    	console.log(result);
	    	res.status(201);
			res.send(result);
	    }
		);
	};



	var listarAtendentesOcupadosPorRegiao = function(donoParametro, req, res){
		console.log('entrou na listagem de atendentes ocupados por regiao');

		var query = [];
		query.push({dono : donoParametro});
		query.push({deletado : false});
		query.push({dataFim :  null});
		query.push({dataApoio :  {$ne: null }});

		var queryFinal = { $and: query };

		console.log(queryFinal);

		chamadoModel.aggregate(
	    [	{
	            "$match": {dono : donoParametro}
        	},
        	 
			{ "$group": { 
		        "_id": {nomeRegiao: "$nomeRegiao", nomeAtendente : "$nomeAtendente"}
			}}
	    ],
	    function(err,result) {
	    	console.log(result);
	    	res.status(201);
			res.send(result);
	    }
		);
	};



	var listarTotaisChamadosDia = function(donoChamado, data, req, res){
		console.log('entrou na listagem de totais compilados de chamados por dia');
		
		var recuperarChamadosDoDia = function() {
		  	var deferred = q.defer();

		  	var query = [];
		  	if(!data){
		  		data = moment();
		  	}
		  	var dataInicioDia = moment(data, "DD-MM-YYYY");
		  	var dataFimDia = moment(data, "DD-MM-YYYY");; 
		  	dataFimDia.set({hour:23,minute:59,second:59,millisecond:99})
		  	
			query.push({dataCriacao : { $gte: dataInicioDia, $lt: dataFimDia }});
			query.push({deletado : false});
			query.push({dono : donoChamado});

			//console.log(query);
			var queryFinal = {};
			if(query && query.length > 0){
				queryFinal = { $and: query };
			}

			chamadoModel.find(queryFinal)
				.exec(function(err, chamados){
					//console.log('chamdos do dia: ',chamados);
					if(!err){
						var returnChamados = [];
						chamados.forEach(function(element, index, array){
							var chamadoObj = element.toJSON();
							chamadoObj.status = classificadorStatus(chamadoObj);
							returnChamados.push(chamadoObj);
						});

				  		deferred.resolve(returnChamados);
					}
				});

		  	return deferred.promise;
		};

		recuperarChamadosDoDia().then(function(chamados) {
			var returnCompilado = [];
			var totalAbertos = chamados.length;
			var totalEmAndamento = 0;
			var totalACaminho = 0;
			var totalFechados = 0;

			//console.log('chegou no nivel de agrupamento pr status');
			//console.log(chamados);

			chamados.forEach(function(element, index, array){

				var chamadoObj = element;
				//console.log(chamadoObj);
				if(chamadoObj.status == "Finalizado"){
	    			totalFechados++;	
	    		} else if(chamadoObj.status == "Em atendimento"){
	    			totalEmAndamento++
	    		} else if(chamadoObj.status == "A caminho"){
	    			totalACaminho++;
	    		} 
			});	

			returnCompilado.push({abertos : totalAbertos});
			returnCompilado.push({andamento : totalEmAndamento});
			returnCompilado.push({caminho : totalACaminho});
			returnCompilado.push({fechados : totalFechados});
			console.log(returnCompilado);
			
			res.status(201);
			res.json(returnCompilado);

		});

	};




	return {
		listarTotaisChamadosDia : listarTotaisChamadosDia,
		listarMediaTemposChamados : listarMediaTemposChamados,
		listarChamadosAbertos : listarChamadosAbertos,
		listarChamadosAbertosPorRegiaoDoAtendente : listarChamadosAbertosPorRegiaoDoAtendente, 
		listarChamadoEmAtendimento : listarChamadoEmAtendimento,
		listarChamadosPorSolicitante : listarChamadosPorSolicitante,
		listarResumoQtdChamadosUltimos : listarResumoQtdChamadosUltimos,
		listarResumoMediaAvaliacoesChamados : listarResumoMediaAvaliacoesChamados,
		listarAtendentesOcupadosPorRegiao :listarAtendentesOcupadosPorRegiao,
		classificarAtendimento : classificarAtendimento,
		avaliarAtendimento : avaliarAtendimento,
		finalizarAtendimento : finalizarAtendimento,
		iniciarAtendimento : iniciarAtendimento,
		pegarAtendimento : pegarAtendimento,
		atualizar 	: atualizar,
		listar 		: listar,
		remover 	: remover,
		removerLogico : removerLogico,
		salvarNovo 	: salvarNovo
	};

};

module.exports = chamadoController;