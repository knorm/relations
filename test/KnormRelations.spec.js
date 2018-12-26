const { snakeCase: fieldToColumn } = require('lodash');
const knorm = require('@knorm/knorm');
const knormPostgres = require('@knorm/postgres');
const KnormRelations = require('../lib/KnormRelations');
const knormRelations = require('../');
const knex = require('./lib/knex');
const sinon = require('sinon');
const expect = require('unexpected')
  .clone()
  .use(require('unexpected-knex'))
  .use(require('unexpected-sinon'))
  .addAssertion(
    '<Promise> to be fulfilled with sorted rows [exhaustively] satisfying <array>',
    (expect, subject, value) => {
      const exhaustive = expect.flags.exhaustively;
      const ascendingOrder = (a, b) => parseInt(a.id) - parseInt(b.id);
      expect.errorMode = 'bubble';
      return expect(
        subject,
        'to be fulfilled with value satisfying',
        subject => {
          expect(subject, 'to be an array');
          expect(
            subject,
            'sorted by',
            ascendingOrder,
            exhaustive ? 'to exhaustively satisfy' : 'to satisfy',
            value
          );
        }
      );
    }
  )
  .addAssertion(
    '<knexQuery> to have sorted rows [exhaustively] satisfying <array>',
    (expect, subject, value) => {
      const ascendingOrder = (a, b) => parseInt(a.id) - parseInt(b.id);
      expect.errorMode = 'bubble';
      return expect(
        subject,
        'to have rows satisfying',
        expect.it(
          'sorted by',
          ascendingOrder,
          'to [exhaustively] satisfy',
          value
        )
      );
    }
  );

const { KnormRelationsError } = KnormRelations;

describe('KnormRelations', () => {
  const orm = knorm({ fieldToColumn })
    .use(knormPostgres({ connection: knex.client.config.connection }))
    .use(knormRelations());

  const Query = orm.Query;

  class Model extends orm.Model {}
  Model.fields = {
    id: { type: 'integer', primary: true, updated: false }
  };

  class User extends Model {}
  User.table = 'user';
  User.fields = {
    name: { type: 'string', required: true },
    confirmed: 'boolean',
    creator: {
      type: 'integer',
      references() {
        return User.fields.id;
      }
    }
  };

  class ImageCategory extends Model {}
  ImageCategory.table = 'image_category';
  ImageCategory.fields = { name: { type: 'string', required: true } };

  class Image extends Model {}
  Image.table = 'image';
  Image.fields = {
    userId: { type: 'integer', references: User.fields.id },
    categoryId: { type: 'integer', references: ImageCategory.fields.id }
  };

  class Message extends Model {}
  Message.table = 'message';
  Message.fields = {
    text: { type: 'text', required: true },
    senderId: { type: 'integer', references: User.fields.id },
    receiverId: { type: 'integer', references: User.fields.id }
  };

  class Group extends Model {}
  Group.table = 'group';
  Group.fields = {
    name: { type: 'string', required: true }
  };

  class GroupMembership extends Model {}
  GroupMembership.table = 'group_membership';
  GroupMembership.fields = {
    name: 'string',
    userId: { type: 'integer', references: User.fields.id },
    groupId: { type: 'integer', references: Group.fields.id }
  };

  class Friendship extends Model {}
  Friendship.table = 'friendship';
  Friendship.fields = {
    userId: { type: 'integer', references: User.fields.id },
    friendId: { type: 'integer', references: User.fields.id }
  };

  before(async () => {
    await knex.schema.createTable(User.table, table => {
      table.increments();
      table.string('name');
      table.boolean('confirmed');
      table.integer('creator');
    });
    await knex.schema.createTable(ImageCategory.table, table => {
      table.increments();
      table.string('name').notNullable();
    });
    await knex.schema.createTable(Image.table, table => {
      table.increments();
      table
        .integer('user_id')
        .references('id')
        .inTable(User.table);
      table
        .integer('category_id')
        .references('id')
        .inTable(ImageCategory.table);
    });
    await knex.schema.createTable(Message.table, table => {
      table.increments();
      table.text('text').notNullable();
      table
        .integer('sender_id')
        .references('id')
        .inTable(User.table);
      table
        .integer('receiver_id')
        .references('id')
        .inTable(User.table);
    });
    await knex.schema.createTable(Group.table, table => {
      table.increments();
      table.string('name').notNullable();
    });
    await knex.schema.createTable(GroupMembership.table, table => {
      table.increments();
      table.string('name');
      table
        .integer('user_id')
        .references('id')
        .inTable(User.table);
      table
        .integer('group_id')
        .references('id')
        .inTable(Group.table);
    });
    await knex.schema.createTable(Friendship.table, table => {
      table.increments();
      table
        .integer('user_id')
        .references('id')
        .inTable(User.table);
      table
        .integer('friend_id')
        .references('id')
        .inTable(User.table);
    });

    await User.insert([
      { id: 1, name: 'User 1', confirmed: null },
      { id: 2, name: 'User 2', confirmed: true }
    ]);
    await ImageCategory.insert([{ id: 1, name: 'User images' }]);
    await Image.insert([{ id: 1, userId: 1, categoryId: 1 }]);
    await Message.insert([
      { id: 1, text: 'Hi User 2', senderId: 1, receiverId: 2 },
      { id: 2, text: 'Hi User 1', senderId: 2, receiverId: 1 }
    ]);
  });

  after(async () => {
    await knex.schema.dropTable(Friendship.table);
    await knex.schema.dropTable(GroupMembership.table);
    await knex.schema.dropTable(Group.table);
    await knex.schema.dropTable(Message.table);
    await knex.schema.dropTable(Image.table);
    await knex.schema.dropTable(ImageCategory.table);
    await knex.schema.dropTable(User.table);
  });

  describe('init', () => {
    it('throws if not passed a `Knorm` instance', () => {
      expect(
        () => new KnormRelations().init(),
        'to throw',
        new KnormRelationsError('no Knorm instance provided')
      );
    });

    it('throws if passed an invalid `Knorm` instance', () => {
      expect(
        () => new KnormRelations().init({}),
        'to throw',
        new KnormRelationsError('invalid Knorm instance provided')
      );
    });
  });

  describe('updateModel', function() {
    describe('enables `Model.config.references`', function() {
      it("returns the model's references", function() {
        class Foo extends Model {}
        class Bar extends Model {}

        Foo.fields = { id: { type: 'integer' } };
        Bar.fields = { fooId: { type: 'integer', references: Foo.fields.id } };

        expect(Bar.config.references, 'to exhaustively satisfy', {
          Foo: { fooId: Bar.fields.fooId }
        });
      });

      describe('when a model is subclassed', function() {
        let Foo;

        before(function() {
          Foo = class extends Model {};
          Foo.fields = { id: { type: 'integer' }, id2: { type: 'integer' } };
        });

        it('overwrites references defined in the parent', function() {
          class Bar extends Model {}
          class Quux extends Bar {}

          Bar.fields = {
            fooId: { type: 'integer', references: Foo.fields.id }
          };
          Quux.fields = {
            fooId: { type: 'integer', references: Foo.fields.id2 }
          };

          expect(Model.config.references, 'to exhaustively satisfy', {});
          expect(Bar.config.references, 'to exhaustively satisfy', {
            Foo: { fooId: Bar.fields.fooId }
          });
          expect(Quux.config.references, 'to exhaustively satisfy', {
            Foo: { fooId: Quux.fields.fooId }
          });
        });

        it('overwrites reference functions defined in the parent', function() {
          class Bar extends Model {}
          class Quux extends Bar {}

          Bar.fields = {
            fooId: {
              type: 'integer',
              references() {
                return Foo.fields.id;
              }
            }
          };
          Quux.fields = {
            fooId: {
              type: 'integer',
              references() {
                return Foo.fields.id2;
              }
            }
          };

          expect(
            Model.config.referenceFunctions,
            'to exhaustively satisfy',
            {}
          );
          expect(Bar.config.referenceFunctions, 'to exhaustively satisfy', {
            fooId() {
              return Foo.fields.id;
            }
          });
          expect(Quux.config.referenceFunctions, 'to exhaustively satisfy', {
            fooId() {
              return Foo.fields.id2;
            }
          });
        });

        it("inherits but does not interfere with the parent's references", function() {
          class Bar extends Model {}
          class Quux extends Bar {}

          Bar.fields = {
            fooId: { type: 'integer', references: Foo.fields.id }
          };
          Quux.fields = {
            fooId2: { type: 'integer', references: Foo.fields.id2 }
          };

          expect(Model.config.references, 'to exhaustively satisfy', {});
          expect(Bar.config.references, 'to exhaustively satisfy', {
            Foo: { fooId: Bar.fields.fooId }
          });
          expect(Quux.config.references, 'to exhaustively satisfy', {
            Foo: { fooId: Quux.fields.fooId, fooId2: Quux.fields.fooId2 }
          });
        });

        it("inherits but does not interfere with the parent's reference functions", function() {
          class Bar extends Model {}
          class Quux extends Bar {}

          Bar.fields = {
            fooId: {
              type: 'integer',
              references() {
                return Foo.fields.id;
              }
            }
          };
          Quux.fields = {
            fooId2: {
              type: 'integer',
              references() {
                return Foo.fields.id2;
              }
            }
          };

          expect(
            Model.config.referenceFunctions,
            'to exhaustively satisfy',
            {}
          );
          expect(Bar.config.referenceFunctions, 'to exhaustively satisfy', {
            fooId() {
              return Foo.fields.id;
            }
          });
          expect(Quux.config.referenceFunctions, 'to exhaustively satisfy', {
            fooId() {
              return Foo.fields.id;
            },
            fooId2() {
              return Quux.fields.fooId2;
            }
          });
        });
      });

      describe('when a field is removed', () => {
        it('removes the field', () => {
          class Foo extends Model {}

          Foo.fields = { id: 'integer', foo: 'string' };
          Foo.removeField(Foo.fields.foo);

          expect(Foo.config.fields, 'to have keys', ['id']);
        });

        it("removes the field's references", () => {
          class Foo extends Model {}
          class Bar extends Model {}

          Foo.fields = { id: { type: 'integer' } };
          Bar.fields = {
            id: 'integer',
            fooId: { type: 'integer', references: Foo.fields.id },
            barId: { type: 'integer', references: Foo.fields.id }
          };

          Bar.removeField(Bar.fields.fooId);
          expect(Bar.config.references, 'to exhaustively satisfy', {
            Foo: expect.it('to have keys', ['barId'])
          });

          Bar.removeField(Bar.fields.barId);
          expect(Bar.config.references, 'to be empty');
        });

        it("removes the field's reference function", () => {
          class Foo extends Model {}
          class Bar extends Model {}

          Foo.fields = { id: { type: 'integer' } };
          Bar.fields = {
            id: 'integer',
            fooId: {
              type: 'integer',
              references() {
                return Foo.fields.id;
              }
            }
          };

          expect(Bar.config.referenceFunctions, 'to have key', 'fooId');
          Bar.removeField(Bar.fields.fooId);
          expect(Bar.config.referenceFunctions, 'to be empty');
        });
      });
    });
  });

  describe('updateQuery', () => {
    describe('Query.prototype.fetch', () => {
      describe('with no joins configured', () => {
        it('fetches and populates all instance fields', async () => {
          const query = new Query(User);
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows exhaustively satisfying',
            [
              new User({
                id: 1,
                name: 'User 1',
                confirmed: null,
                creator: null
              }),
              new User({
                id: 2,
                name: 'User 2',
                confirmed: true,
                creator: null
              })
            ]
          );
        });

        describe('with `require` configured', () => {
          it('rejects with a NoRowsFetchedError if no rows are matched', async () => {
            const query = new Query(User).require(true).where({ id: 3 });
            await expect(
              query.fetch(),
              'to be rejected with error satisfying',
              new Query.NoRowsFetchedError({ query })
            );
          });
        });
      });

      describe("with 'distinct' configured", () => {
        it('supports `leftJoin`', async () => {
          await expect(
            new Query(User)
              .distinct(['id', 'name'])
              .leftJoin(Image)
              .fetch(),
            'to be fulfilled with value satisfying',
            rows =>
              expect(
                rows,
                'when sorted by',
                (a, b) => (a.name > b.name ? 1 : -1),
                'to exhaustively satisfy',
                [
                  new User({
                    id: 1,
                    name: 'User 1',
                    image: [new Image({ id: 1, userId: 1, categoryId: 1 })]
                  }),
                  new User({ id: 2, name: 'User 2', image: null })
                ]
              )
          );
        });

        it('supports `innerJoin`', async () => {
          await Image.insert({ id: 2, userId: 1, categoryId: 1 });

          await expect(
            new Query(User)
              .distinct(['id', 'name'])
              .innerJoin(Image)
              .fetch(),
            'to be fulfilled with sorted rows exhaustively satisfying',
            [
              new User({
                id: 1,
                name: 'User 1',
                image: [
                  new Image({ id: 2, userId: 1, categoryId: 1 }),
                  new Image({ id: 1, userId: 1, categoryId: 1 })
                ]
              })
            ]
          );

          await Image.delete({ where: { id: 2 } });
        });
      });

      describe("with a 'leftJoin' configured", () => {
        it('rejects if the models do not reference each other', async () => {
          class Foo extends Model {}
          Foo.table = 'foo';
          await expect(
            new Query(User).leftJoin(new Query(Foo)).fetch(),
            'to be rejected with error satisfying',
            new Query.QueryError('User: there are no references to `Foo`')
          );
          await expect(
            new Query(Foo).leftJoin(new Query(User)).fetch(),
            'to be rejected with error satisfying',
            new Query.QueryError('Foo: there are no references to `User`')
          );
        });

        it('includes the joined models for every instance', async () => {
          const query = new Query(User).leftJoin(new Query(Image));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({
                id: 1,
                name: 'User 1',
                image: [new Image({ id: 1 })]
              }),
              new User({ id: 2, name: 'User 2', image: null })
            ]
          );
        });

        it('populates all instance fields on the joined models', async () => {
          const query = new Query(User).leftJoin(new Query(Image));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows exhaustively satisfying',
            [
              new User({
                id: 1,
                name: 'User 1',
                confirmed: null,
                creator: null,
                image: [new Image({ id: 1, userId: 1, categoryId: 1 })]
              }),
              new User({
                id: 2,
                name: 'User 2',
                confirmed: true,
                creator: null,
                image: null
              })
            ]
          );
        });

        it('includes the joined model as `null` if no rows were matched', async () => {
          const query = new Query(User)
            .leftJoin(new Query(Image))
            .where({ id: 2 });
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new User({ id: 2, name: 'User 2', image: null })]
          );
        });

        it('includes all joined models if more than one rows are matched', async () => {
          await Image.insert({ id: 2, userId: 1, categoryId: 1 });

          const query = new Query(User)
            .where({ id: 1 })
            .leftJoin(new Query(Image));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({
                id: 1,
                name: 'User 1',
                image: [new Image({ id: 1 }), new Image({ id: 2 })]
              })
            ]
          );

          await Image.delete({ where: { id: 2 } });
        });

        it('allows replacing an already existing field on the parent model via `as`', async () => {
          const query = new Query(User).leftJoin(new Query(Image).as('name'));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({ id: 1, name: [new Image({ id: 1 })] }),
              new User({ id: 2, name: null })
            ]
          );
        });

        describe("with 'fields' configured on the joined query", () => {
          it('returns only the requested fields from the joined model', async () => {
            const query = new Query(User)
              .where({ id: 1 })
              .leftJoin(new Query(Image).fields('id'));
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  image: [
                    expect.it('to exhaustively satisfy', new Image({ id: 1 }))
                  ]
                })
              ]
            );
          });

          it('returns all the fields from the parent model', async () => {
            const query = new Query(User)
              .where({ id: 1 })
              .leftJoin(new Query(Image).fields('id'));
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows exhaustively satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  confirmed: null,
                  creator: null,
                  image: [new Image({ id: 1 })]
                })
              ]
            );
          });

          it('allows specifying separate fields on the parent model', async () => {
            const query = new Query(User)
              .where({ id: 1 })
              .fields(['id', 'name'])
              .leftJoin(new Query(Image).fields('id'));
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows exhaustively satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  image: [new Image({ id: 1 })]
                })
              ]
            );
          });

          describe('with no primary field selected', () => {
            it('parses rows correctly by unique fields', async () => {
              class OtherUser extends User {}
              OtherUser.fields = { name: { type: 'string', unique: true } };

              class OtherImage extends Image {}
              OtherImage.fields = {
                userId: { type: 'integer', references: OtherUser.fields.id }
              };

              const query = new Query(OtherUser)
                .fields(['name'])
                .leftJoin(new Query(OtherImage).fields('id'));

              await expect(
                query.fetch(),
                'to be fulfilled with value satisfying',
                rows =>
                  expect(
                    rows,
                    'when sorted by',
                    (a, b) => (a.name > b.name ? 1 : -1),
                    'to exhaustively satisfy',
                    [
                      new OtherUser({
                        name: 'User 1',
                        otherImage: [new OtherImage({ id: 1 })]
                      }),
                      new OtherUser({
                        name: 'User 2',
                        otherImage: null
                      })
                    ]
                  )
              );
            });

            it('rejects if no unique fields are selected either', async () => {
              const query = new Query(User)
                .fields(['name'])
                .leftJoin(new Query(Image).fields('id'));
              await expect(
                query.fetch(),
                'to be rejected with error satisfying',
                new Query.QueryError(
                  'User: cannot join `Image` with no primary or unique fields selected'
                )
              );
            });
          });
        });

        describe("with 'as' configured on the joined query", () => {
          it('uses the passed string as the property name of the joined model', async () => {
            const query = new Query(User)
              .where({ id: 1 })
              .leftJoin(new Query(Image).as('images'));
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  images: [new Image({ id: 1 })]
                })
              ]
            );
          });
        });

        describe("with 'first' configured on the joined query", () => {
          it('returns the first joined model', async () => {
            await Image.insert([{ id: 2, userId: 1, categoryId: 1 }]);
            const query = new Query(User)
              .where({ id: 1 })
              .leftJoin(new Query(Image).first());
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [new User({ id: 1, name: 'User 1', image: new Image({ id: 1 }) })]
            );
            await Image.delete({ where: { id: 2 } });
          });

          it('returns the first joined model with `forge` disabled on the joined query', async () => {
            await Image.insert([{ id: 2, userId: 1, categoryId: 1 }]);
            const query = new Query(User)
              .where({ id: 1 })
              .leftJoin(new Query(Image).first().forge(false));
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [new User({ id: 1, name: 'User 1', image: { id: 1 } })]
            );
            await Image.delete({ where: { id: 2 } });
          });

          it('includes other joined models as `null` if no rows were matched', async () => {
            const query = new Query(User).leftJoin(new Query(Image).first());
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  image: new Image({ id: 1 })
                }),
                new User({ id: 2, name: 'User 2', image: null })
              ]
            );
          });

          it('allows replacing an already existing field on the parent model via `as`', async () => {
            const query = new Query(User).leftJoin(
              new Query(Image).first().as('name')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, name: new Image({ id: 1 }) }),
                new User({ id: 2, name: null })
              ]
            );
          });
        });

        it('creates a left join to the model on all fields wih references', async () => {
          const query = new Query(User).leftJoin(
            new Query(Message).as('messages')
          );
          // this query doesn't match any messages since it joins
          // ON user.id = message.sender_id AND user.id = message.receiver_id
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [{ messages: null }, { messages: null }]
          );
        });

        describe("with 'on' configured on the joined query", () => {
          it('creates a join on the provided field', async () => {
            const query = new Query(User).leftJoin([
              new Query(Message).on('senderId').as('sentMessages'),
              new Query(Message).on('receiverId').as('receivedMessages')
            ]);
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  sentMessages: [new Message({ id: 1, text: 'Hi User 2' })],
                  receivedMessages: [new Message({ id: 2, text: 'Hi User 1' })]
                }),
                new User({
                  id: 2,
                  name: 'User 2',
                  sentMessages: [new Message({ id: 2, text: 'Hi User 1' })],
                  receivedMessages: [new Message({ id: 1, text: 'Hi User 2' })]
                })
              ]
            );
          });

          it('supports passing a field instance', async () => {
            const query = new Query(User).leftJoin([
              new Query(Message).on(Message.fields.senderId).as('sentMessages'),
              new Query(Message)
                .on(Message.fields.receiverId)
                .as('receivedMessages')
            ]);
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  sentMessages: [new Message({ id: 1 })],
                  receivedMessages: [new Message({ id: 2 })]
                }),
                new User({
                  id: 2,
                  sentMessages: [new Message({ id: 2 })],
                  receivedMessages: [new Message({ id: 1 })]
                })
              ]
            );
          });

          it('supports passing a field instance from the other model', async () => {
            const query = new Query(User).leftJoin([
              new Query(Image).on(User.fields.id).as('images')
            ]);
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, images: [new Image({ id: 1 })] }),
                new User({ id: 2, images: null })
              ]
            );
          });
        });

        describe("with 'where' configured on the joined query", () => {
          it('fulfils the requested query on the joined model', async () => {
            await Image.insert({ id: 2, userId: 1, categoryId: 1 });

            const query = new Query(User).leftJoin(
              new Query(Image).where({ id: 2 })
            );

            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  image: [new Image({ id: 2 })]
                })
              ]
            );

            await Image.delete({ where: { id: 2 } });
          });
        });

        describe("with 'where not' configured on the joined query", () => {
          it('fulfils the requested query on the joined model', async () => {
            await Image.insert({ id: 2, userId: 1, categoryId: 1 });

            const where = new Query.Where();
            const query = new Query(User).leftJoin(
              new Query(Image).where(where.not({ id: 2 }))
            );

            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  image: [new Image({ id: 1 })]
                })
              ]
            );

            await Image.delete({ where: { id: 2 } });
          });
        });

        describe("with 'where or' configured on the joined query", () => {
          it('fulfils the requested query on the joined model', async () => {
            await Image.insert({ id: 2, userId: 1, categoryId: 1 });

            const where = new Query.Where();
            const query = new Query(User).leftJoin(
              new Query(Image).where(where.or({ id: 1 }, { id: 2 }))
            );

            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  image: [new Image({ id: 2 }), new Image({ id: 1 })]
                })
              ]
            );

            await Image.delete({ where: { id: 2 } });
          });
        });

        describe("with 'where in' configured on the joined query", () => {
          it('fulfils the requested query on the joined model', async () => {
            await Image.insert([
              { id: 2, userId: 1, categoryId: 1 },
              { id: 3, userId: 1, categoryId: 1 }
            ]);

            const where = new Query.Where();
            const query = new Query(User).leftJoin(
              new Query(Image).where(where.in('id', [1, 2]))
            );

            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  image: [new Image({ id: 2 }), new Image({ id: 1 })]
                })
              ]
            );

            await Image.delete({ where: where.in('id', [2, 3]) });
          });
        });

        describe("with 'orderBy' configured on the joined query", () => {
          it('fulfils the requested order on the joined model', async () => {
            await User.insert({ id: 3, name: 'User 3' });
            await Image.insert([
              { id: 2, userId: 1, categoryId: 1 },
              { id: 3, userId: 3, categoryId: 1 }
            ]);

            const query = new Query(User).leftJoin(
              new Query(Image).orderBy({ id: -1 })
            );

            await expect(
              query.fetch(),
              'to be fulfilled with value satisfying',
              [
                new User({
                  id: 2,
                  name: 'User 2',
                  image: null
                }),
                new User({
                  id: 3,
                  name: 'User 3',
                  image: [new Image({ id: 3 })]
                }),
                new User({
                  id: 1,
                  name: 'User 1',
                  image: [new Image({ id: 2 }), new Image({ id: 1 })]
                })
              ]
            );

            await Image.delete({ where: Image.where.in({ id: [2, 3] }) });
            await User.delete({ where: { id: 3 } });
          });
        });

        describe("with 'groupBy' configured on the joined query", () => {
          it('fulfils the requested grouping on the joined model', async () => {
            await Image.insert({ id: 2, userId: 1, categoryId: 1 });

            const query = new Query(User)
              .where({ id: 1 })
              .groupBy('id')
              .leftJoin(new Query(Image).groupBy(['id', 'userId']));

            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  image: [new Image({ id: 1 }), new Image({ id: 2 })]
                })
              ]
            );

            await Image.delete({ where: { id: 2 } });
          });
        });

        describe("with 'having' configured on the joined query", () => {
          it('fulfils the requested order on the joined model', async () => {
            await Image.insert([
              { id: 2, userId: 1, categoryId: 1 },
              { id: 3, userId: 2, categoryId: 1 }
            ]);

            const query = new Query(User)
              .where({ id: 1 })
              .groupBy('id')
              .leftJoin(
                new Query(Image).groupBy(['id', 'userId']).having({ userId: 1 })
              );

            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  image: [new Image({ id: 1 }), new Image({ id: 2 })]
                })
              ]
            );

            const where = new Query.Where();
            await Image.delete({ where: where.in('id', [2, 3]) });
          });
        });

        describe("with 'forge' disabled", () => {
          describe('on the parent query', () => {
            it('still forges the joined model', async () => {
              const query = new Query(User)
                .forge(false)
                .leftJoin(new Query(Image));

              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  expect.it('not to be a', User).and('to satisfy', {
                    image: [expect.it('to be an', Image)]
                  }),
                  expect.it('to be an object').and('not to be a', User)
                ]
              );
            });
          });

          describe('on the joined model', () => {
            it('includes a plain object of the joined model', async () => {
              const query = new Query(User).leftJoin(
                new Query(Image).forge(false)
              );

              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  expect.it('to be a', User).and('to satisfy', {
                    image: [
                      expect.it('to be an object').and('not to be an', Image)
                    ]
                  }),
                  expect.it('to be a', User)
                ]
              );
            });
          });

          describe('on both the parent and the joined models', () => {
            it('includes plain objects of the both models', async () => {
              const query = new Query(User)
                .forge(false)
                .leftJoin(new Query(Image).forge(false));

              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows exhaustively satisfying',
                [
                  expect.it('not to be a', User).and('to satisfy', {
                    image: [
                      expect.it('to be an object').and('not to be an', Image)
                    ]
                  }),
                  expect.it('to be an object').and('not to be a', User)
                ]
              );
            });
          });

          it('does not include the joined model if no rows were matched', async () => {
            const query = new Query(User)
              .leftJoin(new Query(Image))
              .where({ id: 2 })
              .forge(false);

            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [{ image: null }]
            );
          });

          it('includes all joined models if more than one rows are matched', async () => {
            await Image.insert({ id: 2, userId: 1, categoryId: 1 });

            const query = new Query(User)
              .where({ id: 1 })
              .leftJoin(new Query(Image));
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [{ id: 1, name: 'User 1', image: [{ id: 1 }, { id: 2 }] }]
            );

            await Image.delete({ where: { id: 2 } });
          });
        });

        describe('with `require` configured', () => {
          describe('on the parent query', () => {
            it('rejects with a NoRowsFetchedError if no rows are matched', async () => {
              const imageQuery = new Query(Image).where({ id: 2 });
              const query = new Query(User)
                .require(true)
                .where({ id: 3 })
                .leftJoin(imageQuery);
              await expect(
                query.fetch(),
                'to be rejected with error satisfying',
                new Query.NoRowsFetchedError({ query })
              );
            });
          });

          describe('on the joined query', () => {
            it('rejects with a NoRowsFetchedError if no joined rows are matched', async () => {
              const imageQuery = new Query(Image)
                .where({ id: 2 })
                .require(true);
              const query = new Query(User).leftJoin(imageQuery);
              await expect(
                query.fetch(),
                'to be rejected with error satisfying',
                new Query.NoRowsFetchedError({ query: imageQuery })
              );
            });
          });

          describe('on both the parent and joined queries', () => {
            it('rejects with a NoRowsFetchedError if no rows are matched', async () => {
              const imageQuery = new Query(Image)
                .where({ id: 2 })
                .require(true);
              const query = new Query(User)
                .require(true)
                .where({ id: 3 })
                .leftJoin(imageQuery);
              await expect(
                query.fetch(),
                'to be rejected with error satisfying',
                new Query.NoRowsFetchedError({ query })
              );
            });

            it('rejects with a NoRowsFetchedError if no joined rows are matched', async () => {
              const imageQuery = new Query(Image)
                .where({ id: 2 })
                .require(true);
              const query = new Query(User).require(true).leftJoin(imageQuery);
              await expect(
                query.fetch(),
                'to be rejected with error satisfying',
                new Query.NoRowsFetchedError({ query })
              );
            });
          });
        });

        it('allows passing a model directly', async () => {
          const query = new Query(User).leftJoin(Image);
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({
                id: 1,
                name: 'User 1',
                image: [new Image({ id: 1 })]
              }),
              new User({ id: 2, name: 'User 2' })
            ]
          );
        });

        it('allows passing options when a model is passed directly', async () => {
          const query = new Query(User).leftJoin(Image, { fields: 'id' });
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({
                id: 1,
                name: 'User 1',
                image: [
                  expect.it('to exhaustively satisfy', new Image({ id: 1 }))
                ]
              }),
              new User({
                id: 2,
                name: 'User 2'
              })
            ]
          );
        });

        describe('with a reverse-reference join', () => {
          it('resolves with the correct data', async () => {
            const query = new Query(Image).leftJoin(new Query(User));
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new Image({
                  id: 1,
                  user: [new User({ id: 1, name: 'User 1' })]
                })
              ]
            );
          });

          describe("with the 'on' option configured", () => {
            it('supports as a string', async () => {
              const query = new Query(Image).leftJoin(new Query(User).on('id'));
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Image({
                    id: 1,
                    user: [new User({ id: 1, name: 'User 1' })]
                  })
                ]
              );
            });

            it('supports a field instance', async () => {
              const query = new Query(Image).leftJoin(
                new Query(User).on(User.fields.id)
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Image({
                    id: 1,
                    user: [new User({ id: 1, name: 'User 1' })]
                  })
                ]
              );
            });

            it('supports a field instance from the other model', async () => {
              const query = new Query(Image).leftJoin(
                new Query(User).on(Image.fields.userId)
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Image({
                    id: 1,
                    user: [new User({ id: 1, name: 'User 1' })]
                  })
                ]
              );
            });
          });

          describe('when a field is referenced by multiple fields', () => {
            it('resolves with the correct data', async () => {
              const query = new Query(Message).leftJoin(
                new Query(User).on('id')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows exhaustively satisfying',
                [
                  new Message({
                    id: 1,
                    senderId: 1,
                    receiverId: 2,
                    text: 'Hi User 2',
                    user: [
                      new User({
                        id: 2,
                        name: 'User 2',
                        confirmed: true,
                        creator: null
                      })
                    ]
                  }),
                  new Message({
                    id: 2,
                    senderId: 2,
                    receiverId: 1,
                    text: 'Hi User 1',
                    user: [
                      new User({
                        id: 1,
                        name: 'User 1',
                        confirmed: null,
                        creator: null
                      })
                    ]
                  })
                ]
              );
            });
          });
        });

        describe("with a nested 'leftJoin' query", () => {
          it('includes the nested data in the returned data if rows are matched', async () => {
            const query = new Query(User).leftJoin(
              new Query(Image).leftJoin(new Query(ImageCategory))
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows exhaustively satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  confirmed: null,
                  creator: null,
                  image: [
                    new Image({
                      id: 1,
                      userId: 1,
                      categoryId: 1,
                      imageCategory: [
                        new ImageCategory({ id: 1, name: 'User images' })
                      ]
                    })
                  ]
                }),
                new User({
                  id: 2,
                  name: 'User 2',
                  confirmed: true,
                  creator: null,
                  image: null
                })
              ]
            );
          });

          it('rejects if no primary or unique fields are selected in the nested join', async () => {
            const query = new Query(User).leftJoin(
              new Query(Image).fields('userId').join(new Query(User))
            );
            await expect(
              query.fetch(),
              'to be rejected with error satisfying',
              new Query.QueryError(
                'Image: cannot join `User` with no primary or unique fields selected'
              )
            );
          });
        });

        describe("with a circular 'leftJoin' query", () => {
          it('includes the circular data in the returned data', async () => {
            const query = new Query(User).leftJoin(
              new Query(Image).leftJoin(
                new Query(ImageCategory).leftJoin(
                  new Query(Image).leftJoin(new Query(User))
                )
              )
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows exhaustively satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  confirmed: null,
                  creator: null,
                  image: [
                    new Image({
                      id: 1,
                      userId: 1,
                      categoryId: 1,
                      imageCategory: [
                        new ImageCategory({
                          id: 1,
                          name: 'User images',
                          image: [
                            new Image({
                              id: 1,
                              userId: 1,
                              categoryId: 1,
                              user: [
                                new User({
                                  id: 1,
                                  name: 'User 1',
                                  confirmed: null,
                                  creator: null
                                })
                              ]
                            })
                          ]
                        })
                      ]
                    })
                  ]
                }),
                new User({
                  id: 2,
                  name: 'User 2',
                  confirmed: true,
                  creator: null,
                  image: null
                })
              ]
            );
          });
        });
      });

      describe("with an 'innerJoin' configured", () => {
        it('returns the instances with matching data in the joined table (INNER JOIN)', async () => {
          const query = new Query(User).innerJoin(new Query(Image));
          const spy = sinon.spy(query, 'query');
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new User({ id: 1, name: 'User 1', image: [new Image({ id: 1 })] })]
          );
          await expect(spy, 'to have calls satisfying', () => {
            spy(
              expect.it(
                'when passed as parameter to',
                sql => sql.toString(),
                'to contain',
                ' INNER JOIN '
              )
            );
          });
        });

        it("resolves with an empty array if the join doesn't match any rows", async () => {
          const query = new Query(User)
            .where({ id: 2 })
            .innerJoin(new Query(Image));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows exhaustively satisfying',
            []
          );
        });
      });

      describe("with a 'join' configured", () => {
        it('returns the instances with matching data in the joined table (JOIN)', async () => {
          const query = new Query(User).join(new Query(Image));
          const spy = sinon.spy(query, 'query');
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new User({ id: 1, name: 'User 1', image: [new Image({ id: 1 })] })]
          );
          await expect(spy, 'to have calls satisfying', () => {
            spy(
              expect.it(
                'when passed as parameter to',
                sql => sql.toString(),
                'to contain',
                ' JOIN '
              )
            );
          });
        });

        it("resolves wih an empty array if the join doesn't match any rows", async () => {
          const query = new Query(User).where({ id: 2 }).join(new Query(Image));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows exhaustively satisfying',
            []
          );
        });
      });

      describe('with a `via` configured', () => {
        before(async () => {
          await User.insert([
            { id: 3, name: 'User 3' },
            { id: 4, name: 'User 4' }
          ]);
          await Group.insert([
            { id: 1, name: 'Group 1' },
            { id: 2, name: 'Group 2' }
          ]);
          await GroupMembership.insert([
            { id: 1, userId: 1, groupId: 1 },
            { id: 2, userId: 2, groupId: 2 },
            { id: 3, userId: 3, groupId: 2 }
          ]);
        });

        after(async () => {
          await GroupMembership.delete();
          await Group.delete();
          await User.delete({ where: User.where.in({ id: [3, 4] }) });
        });

        it('rejects if a model has no references to the join query', async () => {
          await expect(
            new Query(User)
              .leftJoin(new Query(Image).via(new Query(GroupMembership)))
              .fetch(),
            'to be rejected with error satisfying',
            new Query.QueryError(
              'GroupMembership: there are no references to `Image`'
            )
          );
          await expect(
            new Query(Image)
              .leftJoin(new Query(User).via(new Query(GroupMembership)))
              .fetch(),
            'to be rejected with error satisfying',
            new Query.QueryError(
              'Image: there are no references to `GroupMembership`'
            )
          );
        });

        it('uses the join query for a many-to-many relation', async () => {
          const query = new Query(User).leftJoin(
            new Query(Group).via(new Query(GroupMembership)).as('groups')
          );
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows exhaustively satisfying',
            [
              new User({
                id: 1,
                name: 'User 1',
                confirmed: null,
                creator: null,
                groups: [new Group({ id: 1, name: 'Group 1' })]
              }),
              new User({
                id: 2,
                name: 'User 2',
                confirmed: true,
                creator: null,
                groups: [new Group({ id: 2, name: 'Group 2' })]
              }),
              new User({
                id: 3,
                name: 'User 3',
                confirmed: null,
                creator: null,
                groups: [new Group({ id: 2, name: 'Group 2' })]
              }),
              new User({
                id: 4,
                name: 'User 4',
                confirmed: null,
                creator: null,
                groups: null
              })
            ]
          );
        });

        describe('with `on` configured', () => {
          class OtherGroupMembership extends GroupMembership {}
          OtherGroupMembership.fields = {
            name: {
              type: 'string',
              references: [User.fields.name, Group.fields.name]
            }
          };

          it('supports join fields as strings', async () => {
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(
                  new Query(OtherGroupMembership).on({
                    User: 'userId',
                    Group: 'groupId'
                  })
                )
                .as('groups')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] }),
                new User({ id: 4, groups: null })
              ]
            );
          });

          it('supports join fields as Field instances', async () => {
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(
                  new Query(OtherGroupMembership).on({
                    User: GroupMembership.fields.userId,
                    Group: GroupMembership.fields.groupId
                  })
                )
                .as('groups')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] }),
                new User({ id: 4, groups: null })
              ]
            );
          });

          it('supports join fields as Field instances from the other model', async () => {
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(
                  new Query(OtherGroupMembership).on({
                    User: User.fields.id,
                    Group: Group.fields.id
                  })
                )
                .as('groups')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] }),
                new User({ id: 4, groups: null })
              ]
            );
          });

          it('supports configuring join fields for the first side of the relation', async () => {
            class OtherGroupMembership extends GroupMembership {}
            OtherGroupMembership.fields = {
              name: {
                type: 'string',
                references: User.fields.name
              }
            };
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(
                  new Query(OtherGroupMembership).on({ User: User.fields.id })
                )
                .as('groups')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] }),
                new User({ id: 4, groups: null })
              ]
            );
          });

          it('supports configuring join fields for the second side of the relation', async () => {
            class OtherGroupMembership extends GroupMembership {}
            OtherGroupMembership.fields = {
              name: {
                type: 'string',
                references: Group.fields.name
              }
            };
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(
                  new Query(OtherGroupMembership).on({ Group: Group.fields.id })
                )
                .as('groups')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] }),
                new User({ id: 4, groups: null })
              ]
            );
          });

          // this is tested under self-referencing many-to-many joins
          // it('supports configuring a single join field for both sides of the relation');
        });

        describe('with a model instead of a query instance', () => {
          it('creates a join query from the model', async () => {
            const query = new Query(User).leftJoin(
              new Query(Group).via(GroupMembership).as('groups')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] }),
                new User({ id: 4, groups: null })
              ]
            );
          });

          it('supports setting join query options via an object', async () => {
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(GroupMembership, {
                  on: { User: 'userId', Group: 'groupId' }
                })
                .as('groups')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] }),
                new User({ id: 4, groups: null })
              ]
            );
          });
        });

        describe('with `joinType` onfigured', () => {
          it('allows configuring the join type for the first side of the join', async () => {
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(GroupMembership, { joinType: { User: 'innerJoin' } })
                .as('groups')
            );
            const spy = sinon.spy(query, 'query');
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] })
              ]
            );
            await expect(spy, 'to have calls satisfying', () => {
              spy(
                expect.it(
                  'when passed as parameter to',
                  sql => sql.toString(),
                  'to satisfy',
                  stringSql =>
                    expect(
                      stringSql,
                      'to contain',
                      'INNER JOIN "group_membership"'
                    ).and('to contain', 'LEFT JOIN "group"')
                )
              );
            });
          });

          it('allows configuring the join type for the second side of the join', async () => {
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(GroupMembership, { joinType: { Group: 'innerJoin' } })
                .as('groups')
            );
            const spy = sinon.spy(query, 'query');
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] })
              ]
            );
            await expect(spy, 'to have calls satisfying', () => {
              spy(
                expect.it(
                  'when passed as parameter to',
                  sql => sql.toString(),
                  'to satisfy',
                  stringSql =>
                    expect(
                      stringSql,
                      'to contain',
                      'LEFT JOIN "group_membership"'
                    ).and('to contain', 'INNER JOIN "group"')
                )
              );
            });
          });

          it('allows configuring a different join type for each side of the join', async () => {
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(GroupMembership, {
                  joinType: { User: 'innerJoin', Group: 'leftJoin' }
                })
                .as('groups')
            );
            const spy = sinon.spy(query, 'query');
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] })
              ]
            );
            await expect(spy, 'to have calls satisfying', () => {
              spy(
                expect.it(
                  'when passed as parameter to',
                  sql => sql.toString(),
                  'to satisfy',
                  stringSql =>
                    expect(
                      stringSql,
                      'to contain',
                      'INNER JOIN "group_membership"'
                    ).and('to contain', 'LEFT JOIN "group"')
                )
              );
            });
          });

          it('allows configuring a single join type for both sides of the join', async () => {
            const query = new Query(User).leftJoin(
              new Query(Group)
                .via(GroupMembership, { joinType: 'innerJoin' })
                .as('groups')
            );
            const spy = sinon.spy(query, 'query');
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, groups: [new Group({ id: 1 })] }),
                new User({ id: 2, groups: [new Group({ id: 2 })] }),
                new User({ id: 3, groups: [new Group({ id: 2 })] })
              ]
            );
            await expect(spy, 'to have calls satisfying', () => {
              spy(
                expect.it(
                  'when passed as parameter to',
                  sql => sql.toString(),
                  'to satisfy',
                  stringSql =>
                    expect(
                      stringSql,
                      'to contain',
                      'INNER JOIN "group_membership"'
                    ).and('to contain', 'INNER JOIN "group"')
                )
              );
            });
          });
        });

        describe('for self-referencing many-to-many relations', () => {
          before(async () => {
            await Friendship.insert([
              { id: 1, userId: 1, friendId: 2 },
              { id: 2, userId: 2, friendId: 1 }
            ]);
          });

          after(async () => {
            await Friendship.delete();
          });

          it('works without requiring join fields configured via `on`', async () => {
            const query = new Query(User).leftJoin(
              new Query(User).via(new Query(Friendship)).as('friends')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows exhaustively satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  confirmed: null,
                  creator: null,
                  friends: [
                    new User({
                      id: 2,
                      name: 'User 2',
                      confirmed: true,
                      creator: null
                    })
                  ]
                }),
                new User({
                  id: 2,
                  name: 'User 2',
                  confirmed: true,
                  creator: null,
                  friends: [
                    new User({
                      id: 1,
                      name: 'User 1',
                      confirmed: null,
                      creator: null
                    })
                  ]
                }),
                new User({
                  id: 3,
                  name: 'User 3',
                  confirmed: null,
                  creator: null,
                  friends: null
                }),
                new User({
                  id: 4,
                  name: 'User 4',
                  confirmed: null,
                  creator: null,
                  friends: null
                })
              ]
            );
          });

          it('works when references are configured with reference functions', async () => {
            class OtherFriendship extends Friendship {}
            OtherFriendship.fields = {
              userId: {
                type: 'integer',
                references() {
                  return User.fields.id;
                }
              },
              friendId: {
                type: 'integer',
                references() {
                  return User.fields.id;
                }
              }
            };
            const query = new Query(User).leftJoin(
              new Query(User).via(new Query(OtherFriendship)).as('friends')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, friends: [new User({ id: 2 })] }),
                new User({ id: 2, friends: [new User({ id: 1 })] }),
                new User({ id: 3, friends: null }),
                new User({ id: 4, friends: null })
              ]
            );
          });

          it('works when multiple references are configured', async () => {
            class OtherFriendship extends Friendship {}
            OtherFriendship.fields = {
              userId: {
                type: 'integer',
                references: [User.fields.id, Group.fields.id]
              },
              friendId: {
                type: 'integer',
                references: [User.fields.id, Group.fields.id]
              }
            };
            const query = new Query(User).leftJoin(
              new Query(User).via(new Query(OtherFriendship)).as('friends')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, friends: [new User({ id: 2 })] }),
                new User({ id: 2, friends: [new User({ id: 1 })] }),
                new User({ id: 3, friends: null }),
                new User({ id: 4, friends: null })
              ]
            );
          });

          it('supports configuring a join field for the first side of the relation', async () => {
            const query = new Query(User).leftJoin(
              new Query(User)
                .via(new Query(Friendship))
                .on({ User: Friendship.fields.userId })
                .as('friends')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, friends: [new User({ id: 2 })] }),
                new User({ id: 2, friends: [new User({ id: 1 })] }),
                new User({ id: 3 }),
                new User({ id: 4 })
              ]
            );
          });

          it('supports configuring a join join field for the second side of the relation', async () => {
            const query = new Query(User).leftJoin(
              new Query(User)
                .via(new Query(Friendship))
                .on({ User: Friendship.fields.friendId })
                .as('friends')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, friends: [new User({ id: 2 })] }),
                new User({ id: 2, friends: [new User({ id: 1 })] }),
                new User({ id: 3 }),
                new User({ id: 4 })
              ]
            );
          });

          it('supports configuring a single join field for both sides of the relation', async () => {
            const query = new Query(User).leftJoin(
              new Query(User)
                .via(new Query(Friendship))
                .on('id')
                .as('friends')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, friends: [new User({ id: 2 })] }),
                new User({ id: 2, friends: [new User({ id: 1 })] }),
                new User({ id: 3 }),
                new User({ id: 4 })
              ]
            );
          });
        });

        describe('for an `innerJoin`', () => {
          // because there's no actual join between the two queries
          it('resolves with the same data as for a `leftJoin`', async () => {
            const query = new Query(User).innerJoin(
              new Query(Group).via(new Query(GroupMembership)).as('groups')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows exhaustively satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  confirmed: null,
                  creator: null,
                  groups: [new Group({ id: 1, name: 'Group 1' })]
                }),
                new User({
                  id: 2,
                  name: 'User 2',
                  confirmed: true,
                  creator: null,
                  groups: [new Group({ id: 2, name: 'Group 2' })]
                }),
                new User({
                  id: 3,
                  name: 'User 3',
                  confirmed: null,
                  creator: null,
                  groups: [new Group({ id: 2, name: 'Group 2' })]
                }),
                new User({
                  id: 4,
                  name: 'User 4',
                  confirmed: null,
                  creator: null,
                  groups: null
                })
              ]
            );
          });
        });

        describe('for a `join`', () => {
          // because there's no actual join between the two queries
          it('resolves with the same data as for a `leftJoin`', async () => {
            const query = new Query(User).join(
              new Query(Group).via(new Query(GroupMembership)).as('groups')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows exhaustively satisfying',
              [
                new User({
                  id: 1,
                  name: 'User 1',
                  confirmed: null,
                  creator: null,
                  groups: [new Group({ id: 1, name: 'Group 1' })]
                }),
                new User({
                  id: 2,
                  name: 'User 2',
                  confirmed: true,
                  creator: null,
                  groups: [new Group({ id: 2, name: 'Group 2' })]
                }),
                new User({
                  id: 3,
                  name: 'User 3',
                  confirmed: null,
                  creator: null,
                  groups: [new Group({ id: 2, name: 'Group 2' })]
                }),
                new User({
                  id: 4,
                  name: 'User 4',
                  confirmed: null,
                  creator: null,
                  groups: null
                })
              ]
            );
          });
        });

        describe('for reverse-references', () => {
          it('resolves with the correct data', async () => {
            const query = new Query(Group).leftJoin(
              new Query(User)
                .via(new Query(GroupMembership))
                .orderBy('id')
                .as('users')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows exhaustively satisfying',
              [
                new Group({
                  id: 1,
                  name: 'Group 1',
                  users: [
                    new User({
                      id: 1,
                      name: 'User 1',
                      confirmed: null,
                      creator: null
                    })
                  ]
                }),
                new Group({
                  id: 2,
                  name: 'Group 2',
                  users: [
                    new User({
                      id: 2,
                      name: 'User 2',
                      confirmed: true,
                      creator: null
                    }),
                    new User({
                      id: 3,
                      name: 'User 3',
                      confirmed: null,
                      creator: null
                    })
                  ]
                })
              ]
            );
          });

          describe('with `on` configured', () => {
            class OtherGroupMembership extends GroupMembership {}
            OtherGroupMembership.fields = {
              name: {
                type: 'string',
                references: [User.fields.name, Group.fields.name]
              }
            };

            it('supports join fields as strings', async () => {
              const query = new Query(Group).leftJoin(
                new Query(User)
                  .via(
                    new Query(OtherGroupMembership).on({
                      User: 'userId',
                      Group: 'groupId'
                    })
                  )
                  .orderBy('id')
                  .as('users')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Group({ id: 1, users: [new User({ id: 1 })] }),
                  new Group({
                    id: 2,
                    users: [new User({ id: 2 }), new User({ id: 3 })]
                  })
                ]
              );
            });

            it('supports join fields as Field instances', async () => {
              const query = new Query(Group).leftJoin(
                new Query(User)
                  .via(
                    new Query(OtherGroupMembership).on({
                      User: GroupMembership.fields.userId,
                      Group: GroupMembership.fields.groupId
                    })
                  )
                  .orderBy('id')
                  .as('users')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Group({ id: 1, users: [new User({ id: 1 })] }),
                  new Group({
                    id: 2,
                    users: [new User({ id: 2 }), new User({ id: 3 })]
                  })
                ]
              );
            });

            it('supports join fields as Field instances from the other model', async () => {
              const query = new Query(Group).leftJoin(
                new Query(User)
                  .via(
                    new Query(OtherGroupMembership).on({
                      User: User.fields.id,
                      Group: Group.fields.id
                    })
                  )
                  .orderBy('id')
                  .as('users')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Group({ id: 1, users: [new User({ id: 1 })] }),
                  new Group({
                    id: 2,
                    users: [new User({ id: 2 }), new User({ id: 3 })]
                  })
                ]
              );
            });

            it('supports configuring join fields for the first side of the relation', async () => {
              class OtherGroupMembership extends GroupMembership {}
              OtherGroupMembership.fields = {
                name: {
                  type: 'string',
                  references: User.fields.name
                }
              };
              const query = new Query(Group).leftJoin(
                new Query(User)
                  .via(
                    new Query(OtherGroupMembership).on({ User: User.fields.id })
                  )
                  .orderBy('id')
                  .as('users')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Group({ id: 1, users: [new User({ id: 1 })] }),
                  new Group({
                    id: 2,
                    users: [new User({ id: 2 }), new User({ id: 3 })]
                  })
                ]
              );
            });

            it('supports configuring join fields for the second side of the relation', async () => {
              class OtherGroupMembership extends GroupMembership {}
              OtherGroupMembership.fields = {
                name: {
                  type: 'string',
                  references: Group.fields.name
                }
              };
              const query = new Query(Group).leftJoin(
                new Query(User)
                  .via(
                    new Query(OtherGroupMembership).on({
                      Group: Group.fields.id
                    })
                  )
                  .orderBy('id')
                  .as('users')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Group({ id: 1, users: [new User({ id: 1 })] }),
                  new Group({
                    id: 2,
                    users: [new User({ id: 2 }), new User({ id: 3 })]
                  })
                ]
              );
            });
          });

          describe('with `joinType` configured', () => {
            it('allows configuring the join type for the first side of the join', async () => {
              const query = new Query(Group).leftJoin(
                new Query(User)
                  .via(GroupMembership, { joinType: { Group: 'innerJoin' } })
                  .orderBy('id')
                  .as('users')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Group({ id: 1, users: [new User({ id: 1 })] }),
                  new Group({
                    id: 2,
                    users: [new User({ id: 2 }), new User({ id: 3 })]
                  })
                ]
              );
            });

            it('allows configuring the join type for the second side of the join', async () => {
              const query = new Query(Group).leftJoin(
                new Query(User)
                  .via(GroupMembership, { joinType: { User: 'innerJoin' } })
                  .orderBy('id')
                  .as('users')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Group({ id: 1, users: [new User({ id: 1 })] }),
                  new Group({
                    id: 2,
                    users: [new User({ id: 2 }), new User({ id: 3 })]
                  })
                ]
              );
            });

            it('allows configuring a different join type for each side of the join', async () => {
              const query = new Query(Group).leftJoin(
                new Query(User)
                  .via(GroupMembership, {
                    joinType: { Group: 'innerJoin', User: 'leftJoin' }
                  })
                  .orderBy('id')
                  .as('users')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Group({ id: 1, users: [new User({ id: 1 })] }),
                  new Group({
                    id: 2,
                    users: [new User({ id: 2 }), new User({ id: 3 })]
                  })
                ]
              );
            });

            it('allows configuring a single join type for both sides of the join', async () => {
              const query = new Query(Group).leftJoin(
                new Query(User)
                  .via(GroupMembership, { joinType: 'innerJoin' })
                  .orderBy('id')
                  .as('users')
              );
              await expect(
                query.fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new Group({ id: 1, users: [new User({ id: 1 })] }),
                  new Group({
                    id: 2,
                    users: [new User({ id: 2 }), new User({ id: 3 })]
                  })
                ]
              );
            });
          });
        });
      });

      describe('with multiple references configured', () => {
        let OtherUser;
        let OtherImage;
        let OtherMessage;

        before(() => {
          OtherUser = class extends User {};
          OtherUser.table = 'user'; // trigger config inheritance

          OtherImage = class extends Model {};
          OtherImage.table = 'image';
          OtherImage.fields = {
            userId: {
              type: 'integer',
              references: [User.fields.id, OtherUser.fields.id]
            }
          };

          OtherMessage = class extends Model {};
          OtherMessage.table = 'message';
          OtherMessage.fields = {
            text: { type: 'text', required: true },
            senderId: {
              type: 'integer',
              references: [User.fields.id, OtherUser.fields.id]
            },
            receiverId: {
              type: 'integer',
              references: [User.fields.id, OtherUser.fields.id]
            }
          };
        });

        it('rejects if models used in a join do not reference each other', async () => {
          class Foo extends Model {}
          Foo.table = 'foo';
          Foo.fields = {
            foo: {
              type: 'integer',
              references: [Message.fields.id, OtherMessage.fields.id]
            }
          };
          await expect(
            new Query(User).leftJoin(new Query(Foo)).fetch(),
            'to be rejected with error satisfying',
            new Query.QueryError('User: there are no references to `Foo`')
          );
          await expect(
            new Query(Foo).leftJoin(new Query(User)).fetch(),
            'to be rejected with error satisfying',
            new Query.QueryError('Foo: there are no references to `User`')
          );
        });

        it('supports `leftJoin`', async () => {
          await expect(
            new Query(User).leftJoin(new Query(OtherImage)).fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({ id: 1, otherImage: [new OtherImage({ id: 1 })] }),
              new User({ id: 2, otherImage: null })
            ]
          );
          await expect(
            new Query(OtherUser).leftJoin(new Query(OtherImage)).fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new OtherUser({ id: 1, otherImage: [new OtherImage({ id: 1 })] }),
              new OtherUser({ id: 2, otherImage: null })
            ]
          );
        });

        describe('supports `on`', () => {
          it('as a string', async () => {
            await expect(
              new Query(User)
                .leftJoin([
                  new Query(OtherMessage).on('senderId').as('sentMessages'),
                  new Query(OtherMessage)
                    .on('receiverId')
                    .as('receivedMessages')
                ])
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  sentMessages: [new OtherMessage({ id: 1 })],
                  receivedMessages: [new OtherMessage({ id: 2 })]
                }),
                new User({
                  id: 2,
                  sentMessages: [new OtherMessage({ id: 2 })],
                  receivedMessages: [new OtherMessage({ id: 1 })]
                })
              ]
            );
            await expect(
              new Query(OtherUser)
                .leftJoin([
                  new Query(OtherMessage).on('senderId').as('sentMessages'),
                  new Query(OtherMessage)
                    .on('receiverId')
                    .as('receivedMessages')
                ])
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new OtherUser({
                  id: 1,
                  sentMessages: [new OtherMessage({ id: 1 })],
                  receivedMessages: [new OtherMessage({ id: 2 })]
                }),
                new OtherUser({
                  id: 2,
                  sentMessages: [new OtherMessage({ id: 2 })],
                  receivedMessages: [new OtherMessage({ id: 1 })]
                })
              ]
            );
          });

          it('as a field instance', async () => {
            await expect(
              new Query(User)
                .leftJoin([
                  new Query(OtherMessage)
                    .on(Message.fields.senderId)
                    .as('sentMessages'),
                  new Query(OtherMessage)
                    .on(Message.fields.receiverId)
                    .as('receivedMessages')
                ])
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  sentMessages: [new OtherMessage({ id: 1 })],
                  receivedMessages: [new OtherMessage({ id: 2 })]
                }),
                new User({
                  id: 2,
                  sentMessages: [new OtherMessage({ id: 2 })],
                  receivedMessages: [new OtherMessage({ id: 1 })]
                })
              ]
            );
            await expect(
              new Query(OtherUser)
                .leftJoin([
                  new Query(OtherMessage)
                    .on(Message.fields.senderId)
                    .as('sentMessages'),
                  new Query(OtherMessage)
                    .on(Message.fields.receiverId)
                    .as('receivedMessages')
                ])
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new OtherUser({
                  id: 1,
                  sentMessages: [new OtherMessage({ id: 1 })],
                  receivedMessages: [new OtherMessage({ id: 2 })]
                }),
                new OtherUser({
                  id: 2,
                  sentMessages: [new OtherMessage({ id: 2 })],
                  receivedMessages: [new OtherMessage({ id: 1 })]
                })
              ]
            );
          });

          it('as a field instance from the other model', async () => {
            await expect(
              new Query(User)
                .leftJoin([
                  new Query(OtherImage).on(User.fields.id).as('images')
                ])
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, images: [new OtherImage({ id: 1 })] }),
                new User({ id: 2, images: null })
              ]
            );
            await expect(
              new Query(OtherUser)
                .leftJoin([
                  new Query(OtherImage).on(OtherUser.fields.id).as('images')
                ])
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new OtherUser({ id: 1, images: [new OtherImage({ id: 1 })] }),
                new OtherUser({ id: 2, images: null })
              ]
            );
          });
        });

        it('supports reverse joins', async () => {
          await expect(
            new Query(OtherImage).leftJoin(new Query(User)).fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new OtherImage({ id: 1, user: [new User({ id: 1 })] })]
          );
          await expect(
            new Query(OtherImage).leftJoin(new Query(OtherUser)).fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new OtherImage({ id: 1, otherUser: [new OtherUser({ id: 1 })] })]
          );
        });

        describe('supports `on` on a reverse join', () => {
          it('as a string', async () => {
            await expect(
              new Query(OtherMessage)
                .leftJoin(new Query(User).on('id'))
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new OtherMessage({ id: 1, user: [new User({ id: 2 })] }),
                new OtherMessage({ id: 2, user: [new User({ id: 1 })] })
              ]
            );
            await expect(
              new Query(OtherMessage)
                .leftJoin(new Query(OtherUser).on('id'))
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new OtherMessage({
                  id: 1,
                  otherUser: [new OtherUser({ id: 2 })]
                }),
                new OtherMessage({
                  id: 2,
                  otherUser: [new OtherUser({ id: 1 })]
                })
              ]
            );
          });

          it('as a field instance ', async () => {
            await expect(
              new Query(OtherMessage)
                .leftJoin(new Query(User).on(User.fields.id))
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new OtherMessage({ id: 1, user: [new User({ id: 2 })] }),
                new OtherMessage({ id: 2, user: [new User({ id: 1 })] })
              ]
            );
            await expect(
              new Query(OtherMessage)
                .leftJoin(new Query(OtherUser).on(OtherUser.fields.id))
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new OtherMessage({
                  id: 1,
                  otherUser: [new OtherUser({ id: 2 })]
                }),
                new OtherMessage({
                  id: 2,
                  otherUser: [new OtherUser({ id: 1 })]
                })
              ]
            );
          });

          it('as a field instance from the other model ', async () => {
            await expect(
              new Query(OtherImage)
                .leftJoin(new Query(User).on(OtherImage.fields.userId))
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [new OtherImage({ id: 1, user: [new User({ id: 1 })] })]
            );
            await expect(
              new Query(OtherImage)
                .leftJoin(new Query(OtherUser).on(OtherImage.fields.userId))
                .fetch(),
              'to be fulfilled with sorted rows satisfying',
              [new OtherImage({ id: 1, otherUser: [new OtherUser({ id: 1 })] })]
            );
          });
        });

        it('supports `join`', async () => {
          await expect(
            new Query(User).join(new Query(OtherImage)).fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new User({ id: 1, otherImage: [new OtherImage({ id: 1 })] })]
          );
          await expect(
            new Query(OtherUser).join(new Query(OtherImage)).fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new OtherUser({ id: 1, otherImage: [new OtherImage({ id: 1 })] })]
          );
        });

        it('supports `innerJoin`', async () => {
          await expect(
            new Query(User).innerJoin(new Query(OtherImage)).fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new User({ id: 1, otherImage: [new OtherImage({ id: 1 })] })]
          );
          await expect(
            new Query(OtherUser).innerJoin(new Query(OtherImage)).fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new OtherUser({ id: 1, otherImage: [new OtherImage({ id: 1 })] })]
          );
        });
      });

      describe('with references configured with a function', () => {
        let OtherImage;
        let OtherMessage;

        before(() => {
          OtherImage = class extends Model {};
          OtherImage.table = 'image';
          OtherImage.fields = {
            userId: {
              type: 'integer',
              references() {
                return User.fields.id;
              }
            },
            categoryId: {
              type: 'integer',
              references() {
                return ImageCategory.fields.id;
              }
            }
          };

          OtherMessage = class extends Model {};
          OtherMessage.table = 'message';
          OtherMessage.fields = {
            text: { type: 'text', required: true },
            senderId: {
              type: 'integer',
              references() {
                return User.fields.id;
              }
            },
            receiverId: {
              type: 'integer',
              references() {
                return User.fields.id;
              }
            }
          };
        });

        it('rejects if models used in a join do not reference each other', async () => {
          class Foo extends Model {}
          Foo.table = 'foo';
          Foo.fields = {
            foo: {
              type: 'integer',
              references() {
                return Message.fields.id;
              }
            }
          };
          await expect(
            new Query(User).leftJoin(new Query(Foo)).fetch(),
            'to be rejected with error satisfying',
            new Query.QueryError('User: there are no references to `Foo`')
          );
          await expect(
            new Query(Foo).leftJoin(new Query(User)).fetch(),
            'to be rejected with error satisfying',
            new Query.QueryError('Foo: there are no references to `User`')
          );
        });

        it('supports `leftJoin`', async () => {
          const query = new Query(User).leftJoin(new Query(OtherImage));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({ id: 1, otherImage: [new OtherImage({ id: 1 })] }),
              new User({ id: 2, otherImage: null })
            ]
          );
        });

        describe('supports `on`', () => {
          it('as a string', async () => {
            const query = new Query(User).leftJoin([
              new Query(OtherMessage).on('senderId').as('sentMessages'),
              new Query(OtherMessage).on('receiverId').as('receivedMessages')
            ]);
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  sentMessages: [new OtherMessage({ id: 1 })],
                  receivedMessages: [new OtherMessage({ id: 2 })]
                }),
                new User({
                  id: 2,
                  sentMessages: [new OtherMessage({ id: 2 })],
                  receivedMessages: [new OtherMessage({ id: 1 })]
                })
              ]
            );
          });

          it('as a field instance', async () => {
            const query = new Query(User).leftJoin([
              new Query(OtherMessage)
                .on(Message.fields.senderId)
                .as('sentMessages'),
              new Query(OtherMessage)
                .on(Message.fields.receiverId)
                .as('receivedMessages')
            ]);
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  sentMessages: [new OtherMessage({ id: 1 })],
                  receivedMessages: [new OtherMessage({ id: 2 })]
                }),
                new User({
                  id: 2,
                  sentMessages: [new OtherMessage({ id: 2 })],
                  receivedMessages: [new OtherMessage({ id: 1 })]
                })
              ]
            );
          });

          it('as a field instance from the other model', async () => {
            const query = new Query(User).leftJoin([
              new Query(OtherImage).on(User.fields.id).as('images')
            ]);
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({ id: 1, images: [new OtherImage({ id: 1 })] }),
                new User({ id: 2, images: null })
              ]
            );
          });
        });

        it('supports reverse joins', async () => {
          const query = new Query(OtherImage).leftJoin(new Query(User));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new OtherImage({ id: 1, user: [new User({ id: 1 })] })]
          );
        });

        describe('supports `on` on a reverse join', () => {
          it('as a string', async () => {
            const query = new Query(OtherMessage).leftJoin(
              new Query(User).on('id')
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new OtherMessage({ id: 1, user: [new User({ id: 2 })] }),
                new OtherMessage({ id: 2, user: [new User({ id: 1 })] })
              ]
            );
          });

          it('as a field instance ', async () => {
            const query = new Query(OtherMessage).leftJoin(
              new Query(User).on(User.fields.id)
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new OtherMessage({ id: 1, user: [new User({ id: 2 })] }),
                new OtherMessage({ id: 2, user: [new User({ id: 1 })] })
              ]
            );
          });

          it('as a field instance from the other model ', async () => {
            const query = new Query(OtherImage).leftJoin(
              new Query(User).on(OtherImage.fields.userId)
            );
            await expect(
              query.fetch(),
              'to be fulfilled with sorted rows satisfying',
              [new OtherImage({ id: 1, user: [new User({ id: 1 })] })]
            );
          });
        });

        it('supports `join`', async () => {
          const query = new Query(User).join(new Query(OtherImage));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new User({ id: 1, otherImage: [new OtherImage({ id: 1 })] })]
          );
        });

        it('supports `innerJoin`', async () => {
          const query = new Query(User).innerJoin(new Query(OtherImage));
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [new User({ id: 1, otherImage: [new OtherImage({ id: 1 })] })]
          );
        });

        it('merges references returned into non-function references', async () => {
          class AnotherMessage extends Model {}
          AnotherMessage.table = 'message';
          AnotherMessage.fields = {
            text: { type: 'text', required: true },
            senderId: {
              type: 'integer',
              references: User.fields.id
            },
            receiverId: {
              type: 'integer',
              references() {
                return User.fields.id;
              }
            }
          };
          const query = new Query(User).leftJoin(
            new Query(AnotherMessage).as('messages')
          );
          // this query doesn't match any messages since it joins
          // ON user.id = message.sender_id AND user.id = message.receiver_id
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [{ messages: null }, { messages: null }]
          );
        });

        describe('with multiple references', () => {
          let AnotherUser;
          let AnotherImage;
          let AnotherMessage;

          before(() => {
            AnotherUser = class extends User {};
            AnotherUser.table = 'user'; // trigger config inheritance

            AnotherImage = class extends Model {};
            AnotherImage.table = 'image';
            AnotherImage.fields = {
              userId: {
                type: 'integer',
                references() {
                  return [User.fields.id, AnotherUser.fields.id];
                }
              }
            };

            AnotherMessage = class extends Model {};
            AnotherMessage.table = 'message';
            AnotherMessage.fields = {
              text: { type: 'text', required: true },
              senderId: {
                type: 'integer',
                references() {
                  return [User.fields.id, AnotherUser.fields.id];
                }
              },
              receiverId: {
                type: 'integer',
                references() {
                  return [User.fields.id, AnotherUser.fields.id];
                }
              }
            };
          });

          it('rejects if models used in a join do not reference each other', async () => {
            class Foo extends Model {}
            Foo.table = 'foo';
            Foo.fields = {
              foo: {
                type: 'integer',
                references() {
                  return [Message.fields.id, AnotherMessage.fields.id];
                }
              }
            };
            await expect(
              new Query(User).leftJoin(new Query(Foo)).fetch(),
              'to be rejected with error satisfying',
              new Query.QueryError('User: there are no references to `Foo`')
            );
            await expect(
              new Query(Foo).leftJoin(new Query(User)).fetch(),
              'to be rejected with error satisfying',
              new Query.QueryError('Foo: there are no references to `User`')
            );
          });

          it('supports `leftJoin`', async () => {
            await expect(
              new Query(User).leftJoin(new Query(AnotherImage)).fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new User({
                  id: 1,
                  anotherImage: [new AnotherImage({ id: 1 })]
                }),
                new User({ id: 2, anotherImage: null })
              ]
            );
            await expect(
              new Query(AnotherUser).leftJoin(new Query(AnotherImage)).fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new AnotherUser({
                  id: 1,
                  anotherImage: [new AnotherImage({ id: 1 })]
                }),
                new AnotherUser({ id: 2, anotherImage: null })
              ]
            );
          });

          describe('supports `on`', () => {
            it('as a string', async () => {
              await expect(
                new Query(User)
                  .leftJoin([
                    new Query(AnotherMessage).on('senderId').as('sentMessages'),
                    new Query(AnotherMessage)
                      .on('receiverId')
                      .as('receivedMessages')
                  ])
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new User({
                    id: 1,
                    sentMessages: [new AnotherMessage({ id: 1 })],
                    receivedMessages: [new AnotherMessage({ id: 2 })]
                  }),
                  new User({
                    id: 2,
                    sentMessages: [new AnotherMessage({ id: 2 })],
                    receivedMessages: [new AnotherMessage({ id: 1 })]
                  })
                ]
              );
              await expect(
                new Query(AnotherUser)
                  .leftJoin([
                    new Query(AnotherMessage).on('senderId').as('sentMessages'),
                    new Query(AnotherMessage)
                      .on('receiverId')
                      .as('receivedMessages')
                  ])
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new AnotherUser({
                    id: 1,
                    sentMessages: [new AnotherMessage({ id: 1 })],
                    receivedMessages: [new AnotherMessage({ id: 2 })]
                  }),
                  new AnotherUser({
                    id: 2,
                    sentMessages: [new AnotherMessage({ id: 2 })],
                    receivedMessages: [new AnotherMessage({ id: 1 })]
                  })
                ]
              );
            });

            it('as a field instance', async () => {
              await expect(
                new Query(User)
                  .leftJoin([
                    new Query(AnotherMessage)
                      .on(Message.fields.senderId)
                      .as('sentMessages'),
                    new Query(AnotherMessage)
                      .on(Message.fields.receiverId)
                      .as('receivedMessages')
                  ])
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new User({
                    id: 1,
                    sentMessages: [new AnotherMessage({ id: 1 })],
                    receivedMessages: [new AnotherMessage({ id: 2 })]
                  }),
                  new User({
                    id: 2,
                    sentMessages: [new AnotherMessage({ id: 2 })],
                    receivedMessages: [new AnotherMessage({ id: 1 })]
                  })
                ]
              );
              await expect(
                new Query(AnotherUser)
                  .leftJoin([
                    new Query(AnotherMessage)
                      .on(Message.fields.senderId)
                      .as('sentMessages'),
                    new Query(AnotherMessage)
                      .on(Message.fields.receiverId)
                      .as('receivedMessages')
                  ])
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new AnotherUser({
                    id: 1,
                    sentMessages: [new AnotherMessage({ id: 1 })],
                    receivedMessages: [new AnotherMessage({ id: 2 })]
                  }),
                  new AnotherUser({
                    id: 2,
                    sentMessages: [new AnotherMessage({ id: 2 })],
                    receivedMessages: [new AnotherMessage({ id: 1 })]
                  })
                ]
              );
            });

            it('as a field instance from the other model', async () => {
              await expect(
                new Query(User)
                  .leftJoin([
                    new Query(AnotherImage).on(User.fields.id).as('images')
                  ])
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new User({ id: 1, images: [new AnotherImage({ id: 1 })] }),
                  new User({ id: 2, images: null })
                ]
              );
              await expect(
                new Query(AnotherUser)
                  .leftJoin([
                    new Query(AnotherImage)
                      .on(AnotherUser.fields.id)
                      .as('images')
                  ])
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new AnotherUser({
                    id: 1,
                    images: [new AnotherImage({ id: 1 })]
                  }),
                  new AnotherUser({ id: 2, images: null })
                ]
              );
            });
          });

          it('supports reverse joins', async () => {
            await expect(
              new Query(AnotherImage).leftJoin(new Query(User)).fetch(),
              'to be fulfilled with sorted rows satisfying',
              [new AnotherImage({ id: 1, user: [new User({ id: 1 })] })]
            );
            await expect(
              new Query(AnotherImage).leftJoin(new Query(AnotherUser)).fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new AnotherImage({
                  id: 1,
                  anotherUser: [new AnotherUser({ id: 1 })]
                })
              ]
            );
          });

          describe('supports `on` on a reverse join', () => {
            it('as a string', async () => {
              await expect(
                new Query(AnotherMessage)
                  .leftJoin(new Query(User).on('id'))
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new AnotherMessage({ id: 1, user: [new User({ id: 2 })] }),
                  new AnotherMessage({ id: 2, user: [new User({ id: 1 })] })
                ]
              );
              await expect(
                new Query(AnotherMessage)
                  .leftJoin(new Query(AnotherUser).on('id'))
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new AnotherMessage({
                    id: 1,
                    anotherUser: [new AnotherUser({ id: 2 })]
                  }),
                  new AnotherMessage({
                    id: 2,
                    anotherUser: [new AnotherUser({ id: 1 })]
                  })
                ]
              );
            });

            it('as a field instance ', async () => {
              await expect(
                new Query(AnotherMessage)
                  .leftJoin(new Query(User).on(User.fields.id))
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new AnotherMessage({ id: 1, user: [new User({ id: 2 })] }),
                  new AnotherMessage({ id: 2, user: [new User({ id: 1 })] })
                ]
              );
              await expect(
                new Query(AnotherMessage)
                  .leftJoin(new Query(AnotherUser).on(AnotherUser.fields.id))
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new AnotherMessage({
                    id: 1,
                    anotherUser: [new AnotherUser({ id: 2 })]
                  }),
                  new AnotherMessage({
                    id: 2,
                    anotherUser: [new AnotherUser({ id: 1 })]
                  })
                ]
              );
            });

            it('as a field instance from the other model ', async () => {
              await expect(
                new Query(AnotherImage)
                  .leftJoin(new Query(User).on(AnotherImage.fields.userId))
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [new AnotherImage({ id: 1, user: [new User({ id: 1 })] })]
              );
              await expect(
                new Query(AnotherImage)
                  .leftJoin(
                    new Query(AnotherUser).on(AnotherImage.fields.userId)
                  )
                  .fetch(),
                'to be fulfilled with sorted rows satisfying',
                [
                  new AnotherImage({
                    id: 1,
                    anotherUser: [new AnotherUser({ id: 1 })]
                  })
                ]
              );
            });
          });

          it('supports `join`', async () => {
            await expect(
              new Query(User).join(new Query(AnotherImage)).fetch(),
              'to be fulfilled with sorted rows satisfying',
              [new User({ id: 1, anotherImage: [new AnotherImage({ id: 1 })] })]
            );
            await expect(
              new Query(AnotherUser).join(new Query(AnotherImage)).fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new AnotherUser({
                  id: 1,
                  anotherImage: [new AnotherImage({ id: 1 })]
                })
              ]
            );
          });

          it('supports `innerJoin`', async () => {
            await expect(
              new Query(User).innerJoin(new Query(AnotherImage)).fetch(),
              'to be fulfilled with sorted rows satisfying',
              [new User({ id: 1, anotherImage: [new AnotherImage({ id: 1 })] })]
            );
            await expect(
              new Query(AnotherUser).innerJoin(new Query(AnotherImage)).fetch(),
              'to be fulfilled with sorted rows satisfying',
              [
                new AnotherUser({
                  id: 1,
                  anotherImage: [new AnotherImage({ id: 1 })]
                })
              ]
            );
          });
        });
      });

      describe('with models referencing themselves', () => {
        before(async () => {
          await User.insert([
            { id: 3, name: 'User 3', creator: 1 },
            { id: 4, name: 'User 4', creator: 2 }
          ]);
        });

        after(async () => {
          await User.delete({
            where: User.where.in({ id: [3, 4] })
          });
        });

        it('supports the self-reference', async () => {
          const query = new Query(User).leftJoin(
            new Query(User).as('creator').first()
          );
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({ id: 1, name: 'User 1', creator: null }),
              new User({ id: 2, name: 'User 2', creator: null }),
              new User({
                id: 3,
                name: 'User 3',
                creator: new User({ id: 1, name: 'User 1' })
              }),
              new User({
                id: 4,
                name: 'User 4',
                creator: new User({ id: 2, name: 'User 2' })
              })
            ]
          );
        });

        it('supports `on` as a string', async () => {
          const query = new Query(User).leftJoin(
            new Query(User)
              .as('creator')
              .on('creator')
              .first()
          );
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({ id: 1, creator: null }),
              new User({ id: 2, creator: null }),
              new User({ id: 3, creator: new User({ id: 1 }) }),
              new User({ id: 4, creator: new User({ id: 2 }) })
            ]
          );
        });

        it('supports `on` as a field instance', async () => {
          const query = new Query(User).leftJoin(
            new Query(User)
              .as('creator')
              .on(User.fields.creator)
              .first()
          );
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({ id: 1, creator: null }),
              new User({ id: 2, creator: null }),
              new User({ id: 3, creator: new User({ id: 1 }) }),
              new User({ id: 4, creator: new User({ id: 2 }) })
            ]
          );
        });

        it('supports `on` with the other field as a string', async () => {
          const query = new Query(User).leftJoin(
            new Query(User)
              .as('creator')
              .on('id')
              .first()
          );
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({ id: 1, creator: null }),
              new User({ id: 2, creator: null }),
              new User({ id: 3, creator: new User({ id: 1 }) }),
              new User({ id: 4, creator: new User({ id: 2 }) })
            ]
          );
        });

        it('supports `on` with the other field as a field instance', async () => {
          const query = new Query(User).leftJoin(
            new Query(User)
              .as('creator')
              .on(User.fields.id)
              .first()
          );
          await expect(
            query.fetch(),
            'to be fulfilled with sorted rows satisfying',
            [
              new User({ id: 1, creator: null }),
              new User({ id: 2, creator: null }),
              new User({ id: 3, creator: new User({ id: 1 }) }),
              new User({ id: 4, creator: new User({ id: 2 }) })
            ]
          );
        });
      });
    });
  });
});
