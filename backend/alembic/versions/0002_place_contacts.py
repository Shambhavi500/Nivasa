"""place contacts: phone, email, website, address and details on POIs; website on listings

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-18 18:40:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0002'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('pois', schema=None) as batch_op:
        batch_op.add_column(sa.Column('phone', sa.String(length=120), nullable=True))
        batch_op.add_column(sa.Column('email', sa.String(length=200), nullable=True))
        batch_op.add_column(sa.Column('website', sa.String(length=300), nullable=True))
        batch_op.add_column(sa.Column('address', sa.String(length=300), nullable=True))
        batch_op.add_column(sa.Column('details', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('contact_source', sa.String(length=300), nullable=True))
    with op.batch_alter_table('listings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('contact_website', sa.String(length=300), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('listings', schema=None) as batch_op:
        batch_op.drop_column('contact_website')
    with op.batch_alter_table('pois', schema=None) as batch_op:
        for col in ('contact_source', 'details', 'address', 'website', 'email', 'phone'):
            batch_op.drop_column(col)
