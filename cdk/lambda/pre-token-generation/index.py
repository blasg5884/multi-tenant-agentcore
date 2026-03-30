def lambda_handler(event, context):
    """
    Cognito Pre Token Generation Lambda Trigger (V3_0)
    ユーザー属性からテナントIDを取得し、アクセストークンとIDトークンに追加
    """
    # ユーザー属性からテナントIDを取得
    tenant_id = event.get('request', {}).get('userAttributes', {}).get('custom:tenant_id')
    
    # V3_0 形式でアクセストークンとIDトークンにテナントIDを追加
    event['response'] = {
        'claimsAndScopeOverrideDetails': {
            'idTokenGeneration': {
                'claimsToAddOrOverride': {
                    'custom:tenant_id': tenant_id
                }
            },
            'accessTokenGeneration': {
                'claimsToAddOrOverride': {
                    'custom:tenant_id': tenant_id
                },
                'scopesToAdd': []
            }
        }
    }
    return event
