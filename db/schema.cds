namespace sample;

/**
 * A deliberately small domain. The point of this sample is the agent and its
 * chat UI, not the data model - swap this for your own and nothing about the
 * plugin changes.
 */
entity Customers {
  key ID      : Integer;
      name    : String(111);
      email   : String(111);
      tickets : Composition of many Tickets on tickets.customer = $self;
}

entity Tickets {
  key ID          : Integer;
      title       : String(200);
      description : String(1000);
      /** open | in-progress | resolved */
      status      : String(20) default 'open';
      /** low | normal | high */
      priority    : String(20) default 'normal';
      customer    : Association to Customers;
      createdAt   : Timestamp;
}
